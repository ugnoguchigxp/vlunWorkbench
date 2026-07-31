import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";
import {
	type AutomatedScanReviewOutput,
	automatedScanReviewOutputSchema,
} from "../../../shared/schemas/automated-diagnostic.schema";
import type { AppDatabase } from "../../db";
import type { LlmRouter } from "../../providers/llmRouter";
import type { LlmTask } from "../../providers/llmTaskTypes";
import type { LlmProvider } from "../../providers/types";
import type { PromptMessageAudit } from "../../system-context/audit";
import {
	bindScanReviewSystemContext,
	bindScanReviewUserMessage,
} from "../../system-context/bindings";
import { executePromptCompletion } from "../../system-context/llm-execution";
import { ScanRepository } from "./repositories";
import {
	buildScanReviewBundle,
	type ScanReviewBundle,
	type ScanReviewBundleOptions,
} from "./scan-review-bundle";
import { ScanReviewRepository } from "./scan-review-repository";
import {
	formatScanReviewRunError,
	parseAutomatedScanReviewOutput,
} from "./scan-review-output-validator";

export type ScanReviewRunnerOptions = ScanReviewBundleOptions & {
	task?: LlmTask;
	providerName?: string;
	providerEndpointId?: string;
	modelName?: string;
	fixtureOutput?: string;
	createdByUserId?: string | null;
	preparedBundle?: ScanReviewBundle;
	diagnosticContext?: {
		inputSnapshotHash: string;
		scannerProvenanceHash: string;
		pipelineVersion: string;
		diagnosticRunId: string;
	};
};

export type ScanReviewRunResult = {
	ok: boolean;
	reviewId: string;
	status: "completed" | "failed";
	error?: string;
};

export type ScanReviewStartResult = {
	reviewId: string;
	status: "running" | "failed";
	error?: string;
	completion: Promise<ScanReviewRunResult>;
};

type ScanReviewRunnerDeps = {
	llmProvider?: LlmProvider;
	llmRouter?: LlmRouter;
	reviewRepository?: ScanReviewRepository;
};

export class ScanReviewRunner {
	private readonly scanRepo: ScanRepository;
	private readonly reviewRepo: ScanReviewRepository;
	private readonly llmProvider?: LlmProvider;
	private readonly llmRouter?: LlmRouter;

	constructor(
		private readonly db: AppDatabase,
		llmProviderOrDeps?: LlmProvider | ScanReviewRunnerDeps,
	) {
		if (
			llmProviderOrDeps &&
			typeof (llmProviderOrDeps as LlmProvider).chatCompletion === "function"
		) {
			this.llmProvider = llmProviderOrDeps as LlmProvider;
		} else {
			const deps = llmProviderOrDeps as ScanReviewRunnerDeps | undefined;
			this.llmProvider = deps?.llmProvider;
			this.llmRouter = deps?.llmRouter;
			this.reviewRepo = deps?.reviewRepository ?? new ScanReviewRepository(db);
		}
		this.scanRepo = new ScanRepository(db);
		this.reviewRepo ??= new ScanReviewRepository(db);
	}

	async start(
		scanRunId: string,
		options: ScanReviewRunnerOptions = {},
	): Promise<ScanReviewStartResult> {
		const scan = await this.scanRepo.findById(scanRunId);
		if (!scan) {
			throw new Error(`Scan run not found: ${scanRunId}`);
		}

		let provider = options.providerName ?? "unresolved";
		let model = options.modelName ?? "unresolved";
		let resolvedProvider = this.llmProvider;

		let bundle: ScanReviewBundle;
		try {
			bundle =
				options.preparedBundle ??
				(await buildScanReviewBundle(this.db, scanRunId, options));
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			const review = await this.reviewRepo.createReview({
				scanRunId,
				projectId: scan.projectId,
				provider,
				model,
				status: "failed",
				createdByUserId: options.createdByUserId,
			});
			await this.reviewRepo.updateReview(review.id, "failed", {
				errorMessage: `Bundle creation failed: ${errorMessage}`,
			});
			const result: ScanReviewRunResult = {
				ok: false,
				reviewId: review.id,
				status: "failed",
				error: errorMessage,
			};
			return {
				reviewId: review.id,
				status: "failed",
				error: errorMessage,
				completion: Promise.resolve(result),
			};
		}

		let providerRouting: Record<string, unknown> | undefined;
		if (!options.fixtureOutput && this.llmRouter) {
			const resolution = await this.llmRouter.resolve(
				options.task ?? "scan_review",
				{
					providerEndpointId: options.providerEndpointId,
					model: options.modelName,
				},
			);
			if (!resolution.ok) {
				const errorMessage = `${resolution.failureKind}: ${resolution.message}`;
				const review = await this.reviewRepo.createReview({
					scanRunId,
					projectId: scan.projectId,
					provider: `route:${resolution.failureKind}`,
					model,
					status: "failed",
					inputBundle: this.persistedInputBundle(bundle, options),
					createdByUserId: options.createdByUserId,
				});
				await this.reviewRepo.updateReview(review.id, "failed", {
					errorMessage,
				});
				const result: ScanReviewRunResult = {
					ok: false,
					reviewId: review.id,
					status: "failed",
					error: errorMessage,
				};
				return {
					reviewId: review.id,
					status: "failed",
					error: errorMessage,
					completion: Promise.resolve(result),
				};
			}
			resolvedProvider = resolution.provider;
			provider = resolution.providerName;
			model = resolution.model;
			providerRouting = {
				task: resolution.task,
				providerEndpointId: resolution.target.providerEndpointId,
				model: resolution.model,
				thinkingDepth: resolution.target.thinkingDepth ?? null,
			};
		}

		const review = await this.reviewRepo.createReview({
			scanRunId,
			projectId: scan.projectId,
			provider,
			model,
			status: "running",
			inputBundle: this.persistedInputBundle(bundle, options),
			createdByUserId: options.createdByUserId,
		});

		const completion = this.completeReview({
			reviewId: review.id,
			bundle,
			options,
			resolvedProvider,
			providerRouting,
		});
		return {
			reviewId: review.id,
			status: "running",
			completion,
		};
	}

	async run(
		scanRunId: string,
		options: ScanReviewRunnerOptions = {},
	): Promise<ScanReviewRunResult> {
		const started = await this.start(scanRunId, options);
		return await started.completion;
	}

	private async completeReview(params: {
		reviewId: string;
		bundle: ScanReviewBundle;
		options: ScanReviewRunnerOptions;
		resolvedProvider?: LlmProvider;
		providerRouting?: Record<string, unknown>;
	}): Promise<ScanReviewRunResult> {
		const { reviewId, bundle, options, resolvedProvider, providerRouting } =
			params;
		try {
			let outputData: AutomatedScanReviewOutput;
			let promptAudit: PromptMessageAudit | undefined;
			let responseContent: string;
			if (options.fixtureOutput) {
				responseContent = await fs.readFile(options.fixtureOutput, "utf8");
				outputData = parseAutomatedScanReviewOutput(responseContent, bundle, {
					enforceJapanese: false,
				});
			} else {
				if (!resolvedProvider) {
					throw new Error("LLM provider is not configured");
				}
				const systemMessage = bindScanReviewSystemContext();
				const userMessage = bindScanReviewUserMessage(bundle);
				const execution = await executePromptCompletion({
					provider: resolvedProvider,
					promptMessages: [systemMessage, userMessage],
					options: {
						temperature: 0.1,
						outputSchema: z.toJSONSchema(automatedScanReviewOutputSchema),
					},
				});
				const response = execution.response;
				responseContent = response.content;
				promptAudit = {
					promptMessages: execution.promptMessageManifests,
					promptSequenceHash: execution.promptSequenceHash,
				};
				outputData = parseAutomatedScanReviewOutput(responseContent, bundle);
			}

			await this.reviewRepo.updateReview(reviewId, "completed", {
				summary: outputData.summary,
				riskOverview: outputData.riskOverview,
				priorityNotes: outputData.priorityNotes,
				coverageNotes: outputData.coverageNotes,
				falsePositiveHotspots: outputData.falsePositiveHotspots,
				recommendedNextActions: outputData.recommendedNextActions,
				findingTriageHints: outputData.findingTriageHints,
				confidenceNotes: outputData.confidenceNotes,
				output: {
					...(outputData as unknown as Record<string, unknown>),
					responseContentSha256: crypto
						.createHash("sha256")
						.update(responseContent)
						.digest("hex"),
					...(providerRouting ? { providerRouting } : {}),
					...(promptAudit
						? {
								systemContext: promptAudit.promptMessages[0],
								promptMessages: promptAudit.promptMessages,
								promptSequenceHash: promptAudit.promptSequenceHash,
							}
						: {}),
				},
			});

			return { ok: true, reviewId, status: "completed" };
		} catch (err) {
			const errorMessage = formatScanReviewRunError(err);
			await this.reviewRepo.updateReview(reviewId, "failed", {
				errorMessage,
			});
			return {
				ok: false,
				reviewId,
				status: "failed",
				error: errorMessage,
			};
		}
	}

	private persistedInputBundle(
		bundle: ScanReviewBundle,
		options: ScanReviewRunnerOptions,
	): Record<string, unknown> {
		return {
			...(bundle as unknown as Record<string, unknown>),
			...(options.diagnosticContext
				? { automatedDiagnostic: options.diagnosticContext }
				: {}),
		};
	}
}
