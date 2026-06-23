import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { findingReviews } from "../../db/schema";

export class FindingReviewRepository {
	constructor(private readonly db: AppDatabase) {}

	async createReview(params: {
		findingId: string;
		provider: string;
		model: string;
		status: "running" | "completed" | "failed";
		inputBundle?: Record<string, unknown> | null;
		createdByUserId?: string | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(findingReviews)
			.values({
				findingId: params.findingId,
				provider: params.provider,
				model: params.model,
				status: params.status,
				confidenceAdjustment: "unknown",
				inputBundle: params.inputBundle ?? null,
				createdByUserId: params.createdByUserId ?? null,
				startedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateReview(
		id: string,
		status: "running" | "completed" | "failed",
		options?: {
			summary?: string | null;
			likelyImpact?: string | null;
			falsePositiveAssessment?: {
				level: "low" | "medium" | "high" | "unknown";
				reasoning: string;
			} | null;
			evidenceStrength?: {
				level: "weak" | "moderate" | "strong" | "unknown";
				reasoning: string;
			} | null;
			remediationDirection?: string | null;
			reviewerNotes?: string[] | null;
			confidenceAdjustment?: "unchanged" | "increase" | "decrease" | "unknown";
			output?: Record<string, unknown> | null;
			errorMessage?: string | null;
			completedAt?: Date | null;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: now,
		};

		if (options?.summary !== undefined) updateValues.summary = options.summary;
		if (options?.likelyImpact !== undefined)
			updateValues.likelyImpact = options.likelyImpact;
		if (options?.falsePositiveAssessment !== undefined)
			updateValues.falsePositiveAssessment = options.falsePositiveAssessment;
		if (options?.evidenceStrength !== undefined)
			updateValues.evidenceStrength = options.evidenceStrength;
		if (options?.remediationDirection !== undefined)
			updateValues.remediationDirection = options.remediationDirection;
		if (options?.reviewerNotes !== undefined)
			updateValues.reviewerNotes = options.reviewerNotes;
		if (options?.confidenceAdjustment !== undefined)
			updateValues.confidenceAdjustment = options.confidenceAdjustment;
		if (options?.output !== undefined) updateValues.output = options.output;
		if (options?.errorMessage !== undefined)
			updateValues.errorMessage = options.errorMessage;

		if (options?.completedAt !== undefined) {
			updateValues.completedAt = options.completedAt;
		} else if (status === "completed" || status === "failed") {
			updateValues.completedAt = now;
		}

		const [updated] = await this.db
			.update(findingReviews)
			.set(updateValues)
			.where(eq(findingReviews.id, id))
			.returning();
		return updated || null;
	}

	async findById(id: string) {
		return (
			(await this.db.query.findingReviews.findFirst({
				where: eq(findingReviews.id, id),
			})) ?? null
		);
	}

	async listReviews(findingId: string) {
		return await this.db.query.findingReviews.findMany({
			where: eq(findingReviews.findingId, findingId),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
	}

	async findLatestReview(findingId: string) {
		return (
			(await this.db.query.findingReviews.findFirst({
				where: eq(findingReviews.findingId, findingId),
				orderBy: (fields, { desc }) => [desc(fields.createdAt)],
			})) ?? null
		);
	}
}
