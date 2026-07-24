import fs from "node:fs/promises";
import { z } from "zod";
import {
	type FindingReviewOutput,
	findingReviewOutputSchema,
} from "../../../shared/schemas/scan.schema";
import type { AppDatabase } from "../../db";
import type { LlmRouter } from "../../providers/llmRouter";
import type { LlmTask } from "../../providers/llmTaskTypes";
import type { LlmProvider } from "../../providers/types";
import { LlmProviderExecutionError } from "../../providers/types";
import type { PromptMessageAudit } from "../../system-context/audit";
import {
	bindFindingReviewSystemContext,
	bindFindingReviewUserMessage,
} from "../../system-context/bindings";
import { executePromptCompletion } from "../../system-context/llm-execution";
import { assertJapaneseTextFields } from "../llm-language";
import { FindingRepository, ProjectRepository } from "../scans/repositories";
import {
	buildReviewBundle,
	type ExtractSnippetOptions,
} from "./finding-review-bundle";
import { FindingReviewRepository } from "./finding-review-repository";

export interface ReviewRunnerOptions extends ExtractSnippetOptions {
	task?: LlmTask;
	providerName?: string;
	providerEndpointId?: string;
	modelName?: string;
	fixtureOutput?: string;
	createdByUserId?: string | null;
}

type FindingReviewRunnerDeps = {
	llmProvider?: LlmProvider;
	llmRouter?: LlmRouter;
};

class StructuredReviewOutputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StructuredReviewOutputError";
	}
}

export class FindingReviewRunner {
	private readonly reviewRepo: FindingReviewRepository;
	private readonly findingRepo: FindingRepository;
	private readonly projectRepo: ProjectRepository;
	private readonly llmProvider?: LlmProvider;
	private readonly llmRouter?: LlmRouter;

	constructor(
		private readonly db: AppDatabase,
		llmProviderOrDeps?: LlmProvider | FindingReviewRunnerDeps,
	) {
		if (
			llmProviderOrDeps &&
			typeof (llmProviderOrDeps as LlmProvider).chatCompletion === "function"
		) {
			this.llmProvider = llmProviderOrDeps as LlmProvider;
		} else {
			const deps = llmProviderOrDeps as FindingReviewRunnerDeps | undefined;
			this.llmProvider = deps?.llmProvider;
			this.llmRouter = deps?.llmRouter;
		}
		this.reviewRepo = new FindingReviewRepository(db);
		this.findingRepo = new FindingRepository(db);
		this.projectRepo = new ProjectRepository(db);
	}

	private extractJsonObject(input: string): string | null {
		const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
		const candidate = fenced?.[1] ?? input;
		const start = candidate.indexOf("{");
		const end = candidate.lastIndexOf("}");
		if (start < 0 || end < start) return null;
		return candidate.slice(start, end + 1);
	}

	private parseReviewOutput(
		responseContent: string,
		options: { enforceJapanese: boolean } = { enforceJapanese: true },
	): FindingReviewOutput {
		const jsonText = this.extractJsonObject(responseContent);
		if (!jsonText) {
			throw new StructuredReviewOutputError(
				"LLM response did not contain a valid JSON object.",
			);
		}
		try {
			const parsed = JSON.parse(jsonText);
			const output = findingReviewOutputSchema.parse(parsed);
			if (options.enforceJapanese) {
				assertJapaneseTextFields(output as unknown as Record<string, unknown>, [
					"summary",
					"likelyImpact",
					"falsePositiveAssessment.reasoning",
					"evidenceStrength.reasoning",
					"remediationDirection",
					"reviewerNotes",
				]);
			}
			return output;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new StructuredReviewOutputError(message);
		}
	}

	private formatRunError(error: unknown): string {
		if (error instanceof LlmProviderExecutionError) {
			return `llm_provider_execution_failed: ${error.message}`;
		}
		if (error instanceof StructuredReviewOutputError) {
			return `llm_structured_output_validation_failed: ${error.message}`;
		}
		return error instanceof Error ? error.message : String(error);
	}

	async run(
		findingId: string,
		options: ReviewRunnerOptions = {},
	): Promise<{
		ok: boolean;
		reviewId: string;
		status: "completed" | "failed";
		error?: string;
	}> {
		const finding = await this.findingRepo.findById(findingId);
		if (!finding) {
			throw new Error(`Finding not found: ${findingId}`);
		}

		const project = await this.projectRepo.findById(finding.projectId);
		if (!project) {
			throw new Error(`Project not found for finding: ${finding.projectId}`);
		}

		let provider = options.providerName ?? "unresolved";
		let model = options.modelName ?? "unresolved";
		let resolvedProvider = this.llmProvider;

		let bundle: Awaited<ReturnType<typeof buildReviewBundle>>;
		try {
			bundle = await buildReviewBundle(
				this.db,
				finding,
				project.repoPath,
				options,
			);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			const review = await this.reviewRepo.createReview({
				findingId,
				provider,
				model,
				status: "failed",
				createdByUserId: options.createdByUserId,
			});
			await this.reviewRepo.updateReview(review.id, "failed", {
				errorMessage: `Bundle creation failed: ${errMsg}`,
			});
			return {
				ok: false,
				reviewId: review.id,
				status: "failed",
				error: errMsg,
			};
		}

		let providerRouting: Record<string, unknown> | undefined;
		if (!options.fixtureOutput && this.llmRouter) {
			const resolution = await this.llmRouter.resolve(
				options.task ?? "finding_review",
				{
					providerEndpointId: options.providerEndpointId,
					model: options.modelName,
				},
			);
			if (!resolution.ok) {
				const errorMessage = `${resolution.failureKind}: ${resolution.message}`;
				const review = await this.reviewRepo.createReview({
					findingId,
					provider: `route:${resolution.failureKind}`,
					model: options.modelName ?? "unresolved",
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
			findingId,
			provider,
			model,
			status: "running",
			inputBundle: bundle as unknown as Record<string, unknown>,
			createdByUserId: options.createdByUserId,
		});

		try {
			let outputData: FindingReviewOutput;
			let promptAudit: PromptMessageAudit | undefined;

			if (options.fixtureOutput) {
				try {
					const fixtureContent = await fs.readFile(
						options.fixtureOutput,
						"utf8",
					);
					const parsed = JSON.parse(fixtureContent);
					outputData = findingReviewOutputSchema.parse(parsed);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					throw new Error(`Failed to parse/validate fixture output: ${msg}`);
				}
			} else {
				if (!resolvedProvider) {
					throw new Error("LLM provider is not configured");
				}

				const systemMessage = bindFindingReviewSystemContext();
				const userMessage = bindFindingReviewUserMessage(bundle);
				const execution = await executePromptCompletion({
					provider: resolvedProvider,
					promptMessages: [systemMessage, userMessage],
					options: {
						temperature: 0.1,
						outputSchema: z.toJSONSchema(findingReviewOutputSchema),
					},
				});
				const response = execution.response;
				promptAudit = {
					promptMessages: execution.promptMessageManifests,
					promptSequenceHash: execution.promptSequenceHash,
				};

				outputData = this.parseReviewOutput(response.content);
			}

			await this.reviewRepo.updateReview(review.id, "completed", {
				summary: outputData.summary,
				likelyImpact: outputData.likelyImpact,
				falsePositiveAssessment: outputData.falsePositiveAssessment,
				evidenceStrength: outputData.evidenceStrength,
				remediationDirection: outputData.remediationDirection,
				reviewerNotes: outputData.reviewerNotes,
				confidenceAdjustment: outputData.confidenceAdjustment,
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

			return { ok: true, reviewId: review.id, status: "completed" };
		} catch (err) {
			const errMsg = this.formatRunError(err);
			await this.reviewRepo.updateReview(review.id, "failed", {
				errorMessage: errMsg,
			});
			return {
				ok: false,
				reviewId: review.id,
				status: "failed",
				error: errMsg,
			};
		}
	}
}
