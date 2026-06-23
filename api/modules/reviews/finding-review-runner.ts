import fs from "node:fs/promises";
import type { AppDatabase } from "../../db";
import { FindingReviewRepository } from "./finding-review-repository";
import { FindingRepository, ProjectRepository } from "../scans/repositories";
import {
	buildReviewBundle,
	type ExtractSnippetOptions,
} from "./finding-review-bundle";
import { buildSystemPrompt, buildUserMessage } from "./finding-review-prompt";
import {
	findingReviewOutputSchema,
	type FindingReviewOutput,
} from "../../../shared/schemas/scan.schema";
import type { LlmProvider } from "../../providers/types";

export interface ReviewRunnerOptions extends ExtractSnippetOptions {
	providerName?: string;
	modelName?: string;
	fixtureOutput?: string;
	createdByUserId?: string | null;
}

export class FindingReviewRunner {
	private readonly reviewRepo: FindingReviewRepository;
	private readonly findingRepo: FindingRepository;
	private readonly projectRepo: ProjectRepository;

	constructor(
		private readonly db: AppDatabase,
		private readonly llmProvider?: LlmProvider,
	) {
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

		const provider = options.providerName ?? "azure-openai";
		const model = options.modelName ?? "gpt-4";

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
				if (!this.llmProvider) {
					throw new Error("LLM provider is not configured");
				}

				const systemPrompt = buildSystemPrompt();
				const userMessage = buildUserMessage(bundle);

				const response = await this.llmProvider.chatCompletion(
					[
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userMessage },
					],
					{
						temperature: 0.1,
					},
				);

				const jsonText = this.extractJsonObject(response.content);
				if (!jsonText) {
					throw new Error("LLM response did not contain a valid JSON object.");
				}

				const parsed = JSON.parse(jsonText);
				outputData = findingReviewOutputSchema.parse(parsed);
			}

			await this.reviewRepo.updateReview(review.id, "completed", {
				summary: outputData.summary,
				likelyImpact: outputData.likelyImpact,
				falsePositiveAssessment: outputData.falsePositiveAssessment,
				evidenceStrength: outputData.evidenceStrength,
				remediationDirection: outputData.remediationDirection,
				reviewerNotes: outputData.reviewerNotes,
				confidenceAdjustment: outputData.confidenceAdjustment,
				output: outputData as unknown as Record<string, unknown>,
			});

			return { ok: true, reviewId: review.id, status: "completed" };
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
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
