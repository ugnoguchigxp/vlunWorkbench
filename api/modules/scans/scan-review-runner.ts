import fs from "node:fs/promises";
import { z } from "zod";
import {
	type ScanReviewOutput,
	scanReviewOutputSchema,
} from "../../../shared/schemas/scan.schema";
import type { AppDatabase } from "../../db";
import type { LlmRouter } from "../../providers/llmRouter";
import type { LlmTask } from "../../providers/llmTaskTypes";
import {
	type LlmProvider,
	LlmProviderExecutionError,
} from "../../providers/types";
import type { PromptMessageAudit } from "../../system-context/audit";
import {
	bindScanReviewSystemContext,
	bindScanReviewUserMessage,
} from "../../system-context/bindings";
import { executePromptCompletion } from "../../system-context/llm-execution";
import { assertJapaneseTextFields } from "../llm-language";
import { ScanRepository } from "./repositories";
import {
	buildScanReviewBundle,
	type ScanReviewBundle,
	type ScanReviewBundleOptions,
} from "./scan-review-bundle";
import { ScanReviewRepository } from "./scan-review-repository";

export type ScanReviewRunnerOptions = ScanReviewBundleOptions & {
	task?: LlmTask;
	providerName?: string;
	providerEndpointId?: string;
	modelName?: string;
	fixtureOutput?: string;
	createdByUserId?: string | null;
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

class StructuredScanReviewOutputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StructuredScanReviewOutputError";
	}
}

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

	private extractJsonObject(input: string): string | null {
		const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
		const candidate = fenced?.[1] ?? input;
		const start = candidate.indexOf("{");
		const end = candidate.lastIndexOf("}");
		if (start < 0 || end < start) return null;
		return candidate.slice(start, end + 1);
	}

	private parseOutput(
		responseContent: string,
		bundle: ScanReviewBundle,
		options: { enforceJapanese: boolean } = { enforceJapanese: true },
	): ScanReviewOutput {
		const jsonText = this.extractJsonObject(responseContent);
		if (!jsonText) {
			throw new StructuredScanReviewOutputError(
				"LLM response did not contain a valid JSON object.",
			);
		}
		try {
			const parsed = JSON.parse(jsonText);
			const parsedOutput = scanReviewOutputSchema.parse(parsed);
			const findingIds = new Set(bundle.findings.map((finding) => finding.id));
			const referencedFindingIds = [
				...parsedOutput.findingTriageHints.map((hint) => ({
					path: "findingTriageHints.findingId",
					findingId: hint.findingId,
				})),
				...parsedOutput.improvementRequest.priorityPlan.flatMap((item, index) =>
					item.findingIds.map((findingId) => ({
						path: `improvementRequest.priorityPlan.${index}.findingIds`,
						findingId,
					})),
				),
				...parsedOutput.improvementRequest.implementationTasks.flatMap(
					(item, index) =>
						item.findingIds.map((findingId) => ({
							path: `improvementRequest.implementationTasks.${index}.findingIds`,
							findingId,
						})),
				),
			];
			const invalidFindingIds = referencedFindingIds.filter(
				(item) => !findingIds.has(item.findingId),
			);
			const normalizationNote =
				"LLM 出力に bundle 外の finding ID が含まれていたため、安全のため参照から除外しました。";
			const output: ScanReviewOutput = {
				...parsedOutput,
				findingTriageHints: parsedOutput.findingTriageHints.filter((hint) =>
					findingIds.has(hint.findingId),
				),
				confidenceNotes:
					invalidFindingIds.length > 0 &&
					parsedOutput.confidenceNotes.length < 20
						? [...parsedOutput.confidenceNotes, normalizationNote]
						: parsedOutput.confidenceNotes,
				improvementRequest: {
					...parsedOutput.improvementRequest,
					priorityPlan: parsedOutput.improvementRequest.priorityPlan
						.map((item) => ({
							...item,
							findingIds: item.findingIds.filter((findingId) =>
								findingIds.has(findingId),
							),
						}))
						.filter(
							(item) =>
								bundle.findings.length === 0 || item.findingIds.length > 0,
						),
					implementationTasks:
						parsedOutput.improvementRequest.implementationTasks
							.map((item) => ({
								...item,
								findingIds: item.findingIds.filter((findingId) =>
									findingIds.has(findingId),
								),
							}))
							.filter(
								(item) =>
									bundle.findings.length === 0 || item.findingIds.length > 0,
							),
				},
			};
			if (bundle.findings.length > 0) {
				const emptyFindingReferences = [
					...(output.improvementRequest.priorityPlan.length === 0
						? ["improvementRequest.priorityPlan"]
						: []),
					...output.improvementRequest.priorityPlan.flatMap((item, index) =>
						item.findingIds.length === 0
							? [`improvementRequest.priorityPlan.${index}.findingIds`]
							: [],
					),
					...(output.improvementRequest.implementationTasks.length === 0
						? ["improvementRequest.implementationTasks"]
						: []),
					...output.improvementRequest.implementationTasks.flatMap(
						(item, index) =>
							item.findingIds.length === 0
								? [`improvementRequest.implementationTasks.${index}.findingIds`]
								: [],
					),
				];
				if (emptyFindingReferences.length > 0) {
					throw new StructuredScanReviewOutputError(
						`scan review output omitted finding references for non-empty bundle: ${emptyFindingReferences.join(", ")}`,
					);
				}
			}
			if (options.enforceJapanese) {
				assertJapaneseTextFields(output as unknown as Record<string, unknown>, [
					"summary",
					"riskOverview",
					"priorityNotes",
					"coverageNotes",
					"falsePositiveHotspots",
					"recommendedNextActions",
					"confidenceNotes",
					"improvementRequest.title",
					"improvementRequest.objective",
					"improvementRequest.scope",
					"improvementRequest.acceptanceCriteria",
					"improvementRequest.constraints",
					"improvementRequest.nonGoals",
					"improvementRequest.handoffPrompt",
				]);
				for (const [index, hint] of output.findingTriageHints.entries()) {
					try {
						assertJapaneseTextFields(
							hint as unknown as Record<string, unknown>,
							["note"],
						);
					} catch (error) {
						throw new Error(
							error instanceof Error
								? error.message.replace(
										"note",
										`findingTriageHints.${index}.note`,
									)
								: String(error),
						);
					}
				}
				for (const [
					index,
					item,
				] of output.improvementRequest.priorityPlan.entries()) {
					try {
						assertJapaneseTextFields(
							item as unknown as Record<string, unknown>,
							["rationale"],
						);
					} catch (error) {
						throw new Error(
							error instanceof Error
								? error.message.replace(
										"rationale",
										`improvementRequest.priorityPlan.${index}.rationale`,
									)
								: String(error),
						);
					}
				}
				for (const [
					index,
					item,
				] of output.improvementRequest.implementationTasks.entries()) {
					try {
						assertJapaneseTextFields(
							item as unknown as Record<string, unknown>,
							["title", "body"],
						);
					} catch (error) {
						throw new Error(
							error instanceof Error
								? error.message
										.replace(
											"title",
											`improvementRequest.implementationTasks.${index}.title`,
										)
										.replace(
											"body",
											`improvementRequest.implementationTasks.${index}.body`,
										)
								: String(error),
						);
					}
				}
			}
			return output;
		} catch (error) {
			if (error instanceof StructuredScanReviewOutputError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			throw new StructuredScanReviewOutputError(message);
		}
	}

	private formatRunError(error: unknown): string {
		if (error instanceof LlmProviderExecutionError) {
			return `llm_provider_execution_failed: ${error.message}`;
		}
		if (error instanceof StructuredScanReviewOutputError) {
			return `llm_structured_output_validation_failed: ${error.message}`;
		}
		return error instanceof Error ? error.message : String(error);
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
			bundle = await buildScanReviewBundle(this.db, scanRunId, options);
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
					inputBundle: bundle as unknown as Record<string, unknown>,
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
			inputBundle: bundle as unknown as Record<string, unknown>,
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
			let outputData: ScanReviewOutput;
			let promptAudit: PromptMessageAudit | undefined;
			if (options.fixtureOutput) {
				const fixtureContent = await fs.readFile(options.fixtureOutput, "utf8");
				outputData = this.parseOutput(fixtureContent, bundle, {
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
						outputSchema: z.toJSONSchema(scanReviewOutputSchema),
					},
				});
				const response = execution.response;
				promptAudit = {
					promptMessages: execution.promptMessageManifests,
					promptSequenceHash: execution.promptSequenceHash,
				};
				outputData = this.parseOutput(response.content, bundle);
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
			const errorMessage = this.formatRunError(err);
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
}
