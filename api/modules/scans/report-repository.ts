import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { scanReports } from "../../db/schema";

export class ScanReportRepository {
	constructor(private readonly db: AppDatabase) {}

	async createReport(params: {
		scanRunId: string;
		format: string;
		title: string;
		options: Record<string, unknown>;
		status: "running" | "completed" | "failed";
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
				generatedByUserId: params.generatedByUserId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateReportStatus(
		id: string,
		status: "running" | "completed" | "failed",
		options?: {
			artifactId?: string | null;
			summary?: string | null;
			errorMessage?: string | null;
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
		if (options?.options !== undefined) {
			updateValues.options = options.options;
		}

		const [updated] = await this.db
			.update(scanReports)
			.set(updateValues)
			.where(eq(scanReports.id, id))
			.returning();
		return updated || null;
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
}
