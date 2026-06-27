import fs from "node:fs/promises";
import { z } from "zod";
import type { AppDatabase } from "../../db";
import {
	LlmProviderExecutionError,
	type LlmProvider,
} from "../../providers/types";
import type { LlmRouter } from "../../providers/llmRouter";
import type { LlmTask } from "../../providers/llmTaskTypes";
import { assertJapaneseTextFields } from "../llm-language";
import {
	scanReviewOutputSchema,
	type ScanReviewOutput,
} from "../../../shared/schemas/scan.schema";
import {
	buildScanReviewBundle,
	type ScanReviewBundle,
	type ScanReviewBundleOptions,
} from "./scan-review-bundle";
import {
	buildScanReviewSystemPrompt,
	buildScanReviewUserMessage,
} from "./scan-review-prompt";
import { ScanReviewRepository } from "./scan-review-repository";
import { ScanRepository } from "./repositories";

export type ScanReviewRunnerOptions = ScanReviewBundleOptions & {
	task?: LlmTask;
	providerName?: string;
	providerEndpointId?: string;
	modelName?: string;
	fixtureOutput?: string;
	createdByUserId?: string | null;
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
			const output = scanReviewOutputSchema.parse(parsed);
			const findingIds = new Set(bundle.findings.map((finding) => finding.id));
			const invalidFindingIds = output.findingTriageHints
				.map((hint) => hint.findingId)
				.filter((findingId) => !findingIds.has(findingId));
			if (invalidFindingIds.length > 0) {
				throw new StructuredScanReviewOutputError(
					`findingTriageHints referenced findings not in bundle: ${invalidFindingIds.join(", ")}`,
				);
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

	async run(
		scanRunId: string,
		options: ScanReviewRunnerOptions = {},
	): Promise<{
		ok: boolean;
		reviewId: string;
		status: "completed" | "failed";
		error?: string;
	}> {
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
			return {
				ok: false,
				reviewId: review.id,
				status: "failed",
				error: errorMessage,
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
				return {
					ok: false,
					reviewId: review.id,
					status: "failed",
					error: errorMessage,
				};
			}
			resolvedProvider = resolution.provider;
			provider = resolution.providerName;
			model = resolution.model;
			providerRouting = {
				task: resolution.task,
				providerEndpointId: resolution.target.providerEndpointId,
				model: resolution.model,
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

		try {
			let outputData: ScanReviewOutput;
			if (options.fixtureOutput) {
				const fixtureContent = await fs.readFile(options.fixtureOutput, "utf8");
				outputData = this.parseOutput(fixtureContent, bundle, {
					enforceJapanese: false,
				});
			} else {
				if (!resolvedProvider) {
					throw new Error("LLM provider is not configured");
				}
				const response = await resolvedProvider.chatCompletion(
					[
						{ role: "system", content: buildScanReviewSystemPrompt() },
						{ role: "user", content: buildScanReviewUserMessage(bundle) },
					],
					{
						temperature: 0.1,
						outputSchema: z.toJSONSchema(scanReviewOutputSchema),
					},
				);
				outputData = this.parseOutput(response.content, bundle);
			}

			await this.reviewRepo.updateReview(review.id, "completed", {
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
				},
			});

			return { ok: true, reviewId: review.id, status: "completed" };
		} catch (err) {
			const errorMessage = this.formatRunError(err);
			await this.reviewRepo.updateReview(review.id, "failed", {
				errorMessage,
			});
			return {
				ok: false,
				reviewId: review.id,
				status: "failed",
				error: errorMessage,
			};
		}
	}
}
