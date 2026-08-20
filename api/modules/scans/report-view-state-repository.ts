import { and, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { scanReportUserViews } from "../../db/schema";

export class ReportViewStateRepository {
	constructor(private readonly db: AppDatabase) {}

	async get(reportId: string, userId: string) {
		return (
			(await this.db.query.scanReportUserViews.findFirst({
				where: and(
					eq(scanReportUserViews.reportId, reportId),
					eq(scanReportUserViews.userId, userId),
				),
			})) ?? null
		);
	}

	/** First acknowledgement wins; later closes must not rewrite the audit time. */
	async markLlmCommentSeen(reportId: string, userId: string) {
		const existing = await this.get(reportId, userId);
		if (existing?.llmCommentSeenAt) return existing;
		const now = new Date();
		await this.db
			.insert(scanReportUserViews)
			.values({
				reportId,
				userId,
				llmCommentSeenAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing();
		const saved = await this.get(reportId, userId);
		if (!saved) throw new Error("Report viewer state was not persisted.");
		if (saved.llmCommentSeenAt) return saved;

		const [updated] = await this.db
			.update(scanReportUserViews)
			.set({ llmCommentSeenAt: now, updatedAt: now })
			.where(
				and(
					eq(scanReportUserViews.reportId, reportId),
					eq(scanReportUserViews.userId, userId),
					isNull(scanReportUserViews.llmCommentSeenAt),
				),
			)
			.returning();
		if (updated) return updated;
		const concurrentlyUpdated = await this.get(reportId, userId);
		if (!concurrentlyUpdated) {
			throw new Error("Report viewer state disappeared while being updated.");
		}
		return concurrentlyUpdated;
	}
}
