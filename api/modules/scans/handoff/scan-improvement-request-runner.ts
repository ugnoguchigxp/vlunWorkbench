import crypto from "node:crypto";
import { z } from "zod";
import {
	type ScanImprovementRequest,
	scanImprovementRequestSchema,
	scanReviewOutputSchema,
} from "../../../../shared/schemas/scan.schema";
import type { AppDatabase } from "../../../db";
import type { LlmRouter } from "../../../providers/llmRouter";
import type { LlmProvider } from "../../../providers/types";
import { LlmProviderExecutionError } from "../../../providers/types";
import type { PromptMessageAudit } from "../../../system-context/audit";
import {
	bindImprovementRequestSystemContext,
	bindImprovementRequestUserMessage,
} from "../../../system-context/bindings";
import { executePromptCompletion } from "../../../system-context/llm-execution";
import { ScanRepository } from "../repositories";
import {
	mergeScanImprovementRequests,
	parseChunkImprovementRequest,
	StructuredImprovementRequestError,
} from "./scan-improvement-request-builder";
import {
	buildScanReviewBundle,
	type ScanReviewBundle,
} from "./scan-review-bundle";
import { ScanReviewRepository } from "./scan-review-repository";

const CHUNK_SIZE = 50;

type RunnerDeps = {
	llmProvider?: LlmProvider;
	llmRouter?: LlmRouter;
	reviewRepository?: ScanReviewRepository;
};

export type ScanImprovementRequestRunResult = {
	ok: boolean;
	reviewId: string;
	status: "completed" | "failed";
	error?: string;
};

export type ScanImprovementRequestStartResult = {
	reviewId: string;
	status: "running" | "failed";
	error?: string;
	completion: Promise<ScanImprovementRequestRunResult>;
};

type GeneratedChunk = {
	request: ScanImprovementRequest;
	audit: PromptMessageAudit;
	responseContentSha256: string;
};

export { mergeScanImprovementRequests } from "./scan-improvement-request-builder";

export class ScanImprovementRequestRunner {
	private readonly scanRepository: ScanRepository;
	private readonly reviewRepository: ScanReviewRepository;
	private readonly llmProvider?: LlmProvider;
	private readonly llmRouter?: LlmRouter;
	private readonly startingByScanRunId = new Map<
		string,
		Promise<ScanImprovementRequestStartResult>
	>();
	private readonly activeByScanRunId = new Map<
		string,
		{ reviewId: string; completion: Promise<ScanImprovementRequestRunResult> }
	>();
	private shuttingDown = false;

	constructor(
		private readonly db: AppDatabase,
		providerOrDeps?: LlmProvider | RunnerDeps,
	) {
		if (
			providerOrDeps &&
			typeof (providerOrDeps as LlmProvider).chatCompletion === "function"
		) {
			this.llmProvider = providerOrDeps as LlmProvider;
		} else {
			const deps = providerOrDeps as RunnerDeps | undefined;
			this.llmProvider = deps?.llmProvider;
			this.llmRouter = deps?.llmRouter;
			this.reviewRepository =
				deps?.reviewRepository ?? new ScanReviewRepository(db);
		}
		this.scanRepository = new ScanRepository(db);
		this.reviewRepository ??= new ScanReviewRepository(db);
	}

	async start(
		scanRunId: string,
		options: { createdByUserId?: string | null } = {},
	): Promise<ScanImprovementRequestStartResult> {
		if (this.shuttingDown) {
			throw new Error("Improvement request runner is shutting down.");
		}
		const active = this.activeByScanRunId.get(scanRunId);
		if (active) {
			return {
				reviewId: active.reviewId,
				status: "running",
				completion: active.completion,
			};
		}
		const pending = this.startingByScanRunId.get(scanRunId);
		if (pending) return await pending;
		const operation = this.startOnce(scanRunId, options);
		this.startingByScanRunId.set(scanRunId, operation);
		try {
			return await operation;
		} finally {
			if (this.startingByScanRunId.get(scanRunId) === operation) {
				this.startingByScanRunId.delete(scanRunId);
			}
		}
	}

	private async startOnce(
		scanRunId: string,
		options: { createdByUserId?: string | null },
	): Promise<ScanImprovementRequestStartResult> {
		const running =
			await this.reviewRepository.findRunningImprovementRequest(scanRunId);
		if (running) {
			await this.failInterruptedReview(running.id);
		}

		const scan = await this.scanRepository.findById(scanRunId);
		if (!scan) throw new Error(`Scan run not found: ${scanRunId}`);
		if (scan.status !== "completed") {
			throw new Error("Improvement request requires a completed scan.");
		}

		let bundles: ScanReviewBundle[];
		try {
			bundles = await this.buildAllBundles(scanRunId);
		} catch (error) {
			return await this.persistStartFailure({
				scanRunId,
				projectId: scan.projectId,
				createdByUserId: options.createdByUserId,
				error,
			});
		}

		let provider = this.llmProvider;
		let providerName = provider ? "configured" : "unresolved";
		let model = "unresolved";
		let providerRouting: Record<string, unknown> | undefined;
		if (this.llmRouter) {
			const resolution = await this.llmRouter.resolve("scan_review");
			if (!resolution.ok) {
				return await this.persistStartFailure({
					scanRunId,
					projectId: scan.projectId,
					createdByUserId: options.createdByUserId,
					error: new Error(`${resolution.failureKind}: ${resolution.message}`),
					inputBundle: buildPersistedInputBundle(bundles),
				});
			}
			provider = resolution.provider;
			providerName = resolution.providerName;
			model = resolution.model;
			providerRouting = {
				task: resolution.task,
				providerEndpointId: resolution.target.providerEndpointId,
				model: resolution.model,
				thinkingDepth: resolution.target.thinkingDepth ?? null,
			};
		}

		const review = await this.reviewRepository.createReview({
			scanRunId,
			projectId: scan.projectId,
			provider: providerName,
			model,
			status: "running",
			inputBundle: buildPersistedInputBundle(bundles),
			createdByUserId: options.createdByUserId,
		});
		const completion = this.complete({
			reviewId: review.id,
			bundles,
			provider,
			providerRouting,
		}).finally(() => {
			const active = this.activeByScanRunId.get(scanRunId);
			if (active?.reviewId === review.id) {
				this.activeByScanRunId.delete(scanRunId);
			}
		});
		this.activeByScanRunId.set(scanRunId, {
			reviewId: review.id,
			completion,
		});
		return { reviewId: review.id, status: "running", completion };
	}

	async recover(): Promise<number> {
		const interrupted =
			await this.reviewRepository.listRunningImprovementRequests();
		const recovered = await Promise.all(
			interrupted.map((review) => this.failInterruptedReview(review.id)),
		);
		return recovered.filter(Boolean).length;
	}

	async shutdown(): Promise<void> {
		this.shuttingDown = true;
		await Promise.allSettled([...this.startingByScanRunId.values()]);
		await Promise.allSettled(
			[...this.activeByScanRunId.values()].map((active) => active.completion),
		);
	}

	private async failInterruptedReview(reviewId: string): Promise<boolean> {
		const failed = await this.reviewRepository.failRunningReview(
			reviewId,
			"Improvement request execution was interrupted by a server restart.",
		);
		return failed !== null;
	}

	private async buildAllBundles(
		scanRunId: string,
	): Promise<ScanReviewBundle[]> {
		const firstBundle = await buildScanReviewBundle(this.db, scanRunId, {
			findingFilter: "all",
			maxFindings: CHUNK_SIZE,
			findingOffset: 0,
		});
		const totalFindings = firstBundle.limits.filteredFindings;
		const bundles = [firstBundle];
		for (
			let findingOffset = CHUNK_SIZE;
			findingOffset < totalFindings;
			findingOffset += CHUNK_SIZE
		) {
			bundles.push(
				await buildScanReviewBundle(this.db, scanRunId, {
					findingFilter: "all",
					maxFindings: CHUNK_SIZE,
					findingOffset,
				}),
			);
		}
		return bundles;
	}

	private async complete(params: {
		reviewId: string;
		bundles: ScanReviewBundle[];
		provider?: LlmProvider;
		providerRouting?: Record<string, unknown>;
	}): Promise<ScanImprovementRequestRunResult> {
		try {
			if (!params.provider) throw new Error("LLM provider is not configured");
			const generated: GeneratedChunk[] = [];
			for (const bundle of params.bundles) {
				generated.push(await this.generateChunk(params.provider, bundle));
			}
			const request = mergeScanImprovementRequests(
				params.bundles,
				generated.map((item) => item.request),
			);
			const totalFindings = params.bundles[0]?.limits.filteredFindings ?? 0;
			const output = scanReviewOutputSchema.parse({
				summary:
					totalFindings > 0
						? `保存済み証跡に基づき、全 ${totalFindings} 件の finding を改修依頼指示書に集約しました。`
						: "finding は 0 件でした。安全宣言を避け、カバレッジ確認の依頼指示書を作成しました。",
				riskOverview: request.objective,
				priorityNotes: request.priorityPlan
					.slice(0, 20)
					.map((item) => item.rationale),
				coverageNotes: request.scope.slice(0, 20),
				falsePositiveHotspots: [],
				recommendedNextActions: request.implementationTasks
					.slice(0, 20)
					.map((item) => item.title),
				findingTriageHints: [],
				confidenceNotes: request.constraints.slice(0, 20),
				improvementRequest: request,
			});
			const findingIds = params.bundles.flatMap((bundle) =>
				bundle.findings.map((finding) => finding.id),
			);
			await this.reviewRepository.updateReview(params.reviewId, "completed", {
				...output,
				output: {
					...output,
					generationKind: "improvement_request",
					coverage: {
						totalFindings,
						coveredFindings: findingIds.length,
						chunkCount: params.bundles.length,
						findingIdsSha256: sha256(JSON.stringify(findingIds)),
					},
					...(params.providerRouting
						? { providerRouting: params.providerRouting }
						: {}),
					promptAudits: generated.map((item) => ({
						promptMessages: item.audit.promptMessages,
						promptSequenceHash: item.audit.promptSequenceHash,
						responseContentSha256: item.responseContentSha256,
					})),
				},
			});
			return { ok: true, reviewId: params.reviewId, status: "completed" };
		} catch (error) {
			const errorMessage = formatError(error);
			await this.reviewRepository.updateReview(params.reviewId, "failed", {
				errorMessage,
			});
			return {
				ok: false,
				reviewId: params.reviewId,
				status: "failed",
				error: errorMessage,
			};
		}
	}

	private async generateChunk(
		provider: LlmProvider,
		bundle: ScanReviewBundle,
	): Promise<GeneratedChunk> {
		const execution = await executePromptCompletion({
			provider,
			promptMessages: [
				bindImprovementRequestSystemContext(),
				bindImprovementRequestUserMessage(bundle),
			],
			options: {
				temperature: 0.1,
				outputSchema: z.toJSONSchema(scanImprovementRequestSchema),
			},
		});
		const request = parseChunkImprovementRequest(
			execution.response.content,
			bundle,
		);
		return {
			request,
			audit: {
				promptMessages: execution.promptMessageManifests,
				promptSequenceHash: execution.promptSequenceHash,
			},
			responseContentSha256: sha256(execution.response.content),
		};
	}

	private async persistStartFailure(params: {
		scanRunId: string;
		projectId: string;
		createdByUserId?: string | null;
		error: unknown;
		inputBundle?: Record<string, unknown>;
	}): Promise<ScanImprovementRequestStartResult> {
		const error = formatError(params.error);
		const review = await this.reviewRepository.createReview({
			scanRunId: params.scanRunId,
			projectId: params.projectId,
			provider: "unresolved",
			model: "unresolved",
			status: "failed",
			inputBundle: params.inputBundle ?? {
				generationKind: "improvement_request",
			},
			createdByUserId: params.createdByUserId,
		});
		await this.reviewRepository.updateReview(review.id, "failed", {
			errorMessage: error,
		});
		return {
			reviewId: review.id,
			status: "failed",
			error,
			completion: Promise.resolve({
				ok: false,
				reviewId: review.id,
				status: "failed",
				error,
			}),
		};
	}
}

function buildPersistedInputBundle(
	bundles: ScanReviewBundle[],
): Record<string, unknown> {
	const findingManifest = bundles.flatMap((bundle) =>
		bundle.findings.map((finding) => ({
			id: finding.id,
			severity: finding.severity,
			sourceTool: finding.sourceTool,
			ruleId: finding.ruleId,
			title: finding.title,
			primaryLocation: finding.primaryLocation,
		})),
	);
	const first = bundles[0];
	return {
		generationKind: "improvement_request",
		scanRun: first?.scanRun,
		project: first?.project,
		limits: {
			totalFindings: findingManifest.length,
			includedFindings: findingManifest.length,
			findingFilter: "all",
			chunkSize: CHUNK_SIZE,
			chunkCount: bundles.length,
		},
		findingManifest,
		findingIdsSha256: sha256(
			JSON.stringify(findingManifest.map((finding) => finding.id)),
		),
	};
}

function formatError(error: unknown): string {
	if (error instanceof LlmProviderExecutionError) {
		return `llm_provider_execution_failed: ${error.message}`;
	}
	if (error instanceof StructuredImprovementRequestError) {
		return `llm_structured_output_validation_failed: ${error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex");
}
