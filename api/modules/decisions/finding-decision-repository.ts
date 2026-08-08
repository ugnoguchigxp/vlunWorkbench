import { desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { findingDecisions, findingReviews } from "../../db/schema";

export class FindingDecisionRepository {
	constructor(private readonly db: AppDatabase) {}

	async createDecision(params: {
		findingId: string;
		decision: "accepted" | "false_positive" | "deferred" | "needs_fix";
		reason: string;
		comment?: string | null;
		linkedReviewId?: string | null;
		decidedByUserId?: string | null;
		metadata?: Record<string, unknown>;
	}) {
		// Validate linked review belongs to the same finding
		if (params.linkedReviewId) {
			const [review] = await this.db
				.select()
				.from(findingReviews)
				.where(eq(findingReviews.id, params.linkedReviewId));

			if (!review) {
				throw new Error("Linked review not found");
			}

			if (review.findingId !== params.findingId) {
				throw new Error("Linked review does not belong to this finding");
			}
		}

		const now = new Date();
		const [created] = await this.db
			.insert(findingDecisions)
			.values({
				findingId: params.findingId,
				decision: params.decision,
				reason: params.reason,
				comment: params.comment ?? null,
				linkedReviewId: params.linkedReviewId ?? null,
				decidedByUserId: params.decidedByUserId ?? null,
				metadata: params.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		return created;
	}

	async findById(id: string) {
		return (
			(await this.db.query.findingDecisions.findFirst({
				where: eq(findingDecisions.id, id),
			})) ?? null
		);
	}

	async listDecisionsForFinding(findingId: string) {
		return await this.db.query.findingDecisions.findMany({
			where: eq(findingDecisions.findingId, findingId),
			orderBy: [desc(findingDecisions.createdAt), desc(findingDecisions.id)],
		});
	}

	async findLatestDecisionForFinding(findingId: string) {
		return (
			(await this.db.query.findingDecisions.findFirst({
				where: eq(findingDecisions.findingId, findingId),
				orderBy: [desc(findingDecisions.createdAt), desc(findingDecisions.id)],
			})) ?? null
		);
	}

	async findLatestDecisionsForFindings(findingIds: string[]) {
		if (findingIds.length === 0) return new Map();
		const rows = await this.db
			.select()
			.from(findingDecisions)
			.where(inArray(findingDecisions.findingId, findingIds))
			.orderBy(desc(findingDecisions.createdAt), desc(findingDecisions.id));
		const latest = new Map<string, (typeof rows)[number]>();
		for (const row of rows) {
			if (!latest.has(row.findingId)) latest.set(row.findingId, row);
		}
		return latest;
	}
}
