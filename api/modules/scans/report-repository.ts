import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { scanReports } from "../../db/schema";

export class ScanReportRepository {
	constructor(private readonly db: AppDatabase) {}

	async createReport(params: {
		scanRunId: string;
		format: string;
		title: string;
		options: Record<string, unknown>;
		status: "queued" | "running" | "completed" | "failed";
		generatedByUserId?: string | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanReports)
			.values({
				scanRunId: params.scanRunId,
				format: params.format,
				title: params.title,
				options: params.options,
				status: params.status,
				startedAt: params.status === "running" ? now : null,
				completedAt:
					params.status === "completed" || params.status === "failed"
						? now
						: null,
				generatedByUserId: params.generatedByUserId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async claimQueuedReport(id: string) {
		const now = new Date();
		const [claimed] = await this.db
			.update(scanReports)
			.set({
				status: "running",
				startedAt: now,
				completedAt: null,
				errorCode: null,
				errorMessage: null,
				retryable: null,
				attemptCount: sql`${scanReports.attemptCount} + 1`,
				updatedAt: now,
			})
			.where(and(eq(scanReports.id, id), eq(scanReports.status, "queued")))
			.returning();
		return claimed ?? null;
	}

	async updateReportStatus(
		id: string,
		status: "queued" | "running" | "completed" | "failed",
		options?: {
			artifactId?: string | null;
			summary?: string | null;
			errorCode?: string | null;
			errorMessage?: string | null;
			retryable?: boolean | null;
			options?: Record<string, unknown>;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: now,
		};
		if (options?.artifactId !== undefined) {
			updateValues.artifactId = options.artifactId;
		}
		if (options?.summary !== undefined) {
			updateValues.summary = options.summary;
		}
		if (options?.errorMessage !== undefined) {
			updateValues.errorMessage = options.errorMessage;
		}
		if (options?.errorCode !== undefined) {
			updateValues.errorCode = options.errorCode;
		}
		if (options?.retryable !== undefined) {
			updateValues.retryable = options.retryable;
		}
		if (options?.options !== undefined) {
			updateValues.options = options.options;
		}
		if (status === "running") updateValues.startedAt = now;
		if (status === "queued") {
			updateValues.startedAt = null;
			updateValues.completedAt = null;
		}
		if (status === "completed" || status === "failed") {
			updateValues.completedAt = now;
		}

		const [updated] = await this.db
			.update(scanReports)
			.set(updateValues)
			.where(
				status === "completed" || status === "failed"
					? and(
							eq(scanReports.id, id),
							inArray(scanReports.status, ["queued", "running"]),
						)
					: eq(scanReports.id, id),
			)
			.returning();
		return updated ?? (await this.findById(id));
	}

	async findById(id: string) {
		return (
			(await this.db.query.scanReports.findFirst({
				where: eq(scanReports.id, id),
			})) ?? null
		);
	}

	async listReportsForScan(scanRunId: string) {
		return await this.db.query.scanReports.findMany({
			where: eq(scanReports.scanRunId, scanRunId),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
	}

	async listActiveReports() {
		return await this.db.query.scanReports.findMany({
			where: inArray(scanReports.status, ["queued", "running"]),
		});
	}
}
