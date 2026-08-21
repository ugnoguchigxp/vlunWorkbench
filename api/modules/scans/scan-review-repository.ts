import { and, desc, eq } from "drizzle-orm";
import type { ScanReviewOutput } from "../../../shared/schemas/scan.schema";
import type { AppDatabase } from "../../db";
import { scanReviews } from "../../db/schema";

export class ScanReviewRepository {
	constructor(private readonly db: AppDatabase) {}

	async createReview(params: {
		scanRunId: string;
		projectId: string;
		provider: string;
		model: string;
		status: "running" | "completed" | "failed";
		inputBundle?: Record<string, unknown> | null;
		createdByUserId?: string | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanReviews)
			.values({
				scanRunId: params.scanRunId,
				projectId: params.projectId,
				provider: params.provider,
				model: params.model,
				status: params.status,
				inputBundle: params.inputBundle ?? {},
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
		options?: Partial<ScanReviewOutput> & {
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
		if (options?.riskOverview !== undefined)
			updateValues.riskOverview = options.riskOverview;
		if (options?.priorityNotes !== undefined)
			updateValues.priorityNotes = options.priorityNotes;
		if (options?.coverageNotes !== undefined)
			updateValues.coverageNotes = options.coverageNotes;
		if (options?.falsePositiveHotspots !== undefined) {
			updateValues.falsePositiveHotspots = options.falsePositiveHotspots;
		}
		if (options?.recommendedNextActions !== undefined) {
			updateValues.recommendedNextActions = options.recommendedNextActions;
		}
		if (options?.findingTriageHints !== undefined) {
			updateValues.findingTriageHints = options.findingTriageHints;
		}
		if (options?.confidenceNotes !== undefined) {
			updateValues.confidenceNotes = options.confidenceNotes;
		}
		if (options?.output !== undefined) updateValues.output = options.output;
		if (options?.errorMessage !== undefined) {
			updateValues.errorMessage = options.errorMessage;
		}
		if (options?.completedAt !== undefined) {
			updateValues.completedAt = options.completedAt;
		} else if (status === "completed" || status === "failed") {
			updateValues.completedAt = now;
		}

		const [updated] = await this.db
			.update(scanReviews)
			.set(updateValues)
			.where(eq(scanReviews.id, id))
			.returning();
		return updated || null;
	}

	async failRunningReview(id: string, errorMessage: string) {
		const now = new Date();
		const [updated] = await this.db
			.update(scanReviews)
			.set({
				status: "failed",
				errorMessage,
				completedAt: now,
				updatedAt: now,
			})
			.where(and(eq(scanReviews.id, id), eq(scanReviews.status, "running")))
			.returning();
		return updated ?? null;
	}

	async findById(id: string) {
		return (
			(await this.db.query.scanReviews.findFirst({
				where: eq(scanReviews.id, id),
			})) ?? null
		);
	}

	async listReviews(scanRunId: string) {
		return await this.db.query.scanReviews.findMany({
			where: eq(scanReviews.scanRunId, scanRunId),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
	}

	async findLatestReview(scanRunId: string) {
		return (
			(await this.db.query.scanReviews.findFirst({
				where: eq(scanReviews.scanRunId, scanRunId),
				orderBy: (fields, { desc }) => [desc(fields.createdAt)],
			})) ?? null
		);
	}

	async findRunningImprovementRequest(scanRunId: string) {
		const rows = await this.db.query.scanReviews.findMany({
			where: and(
				eq(scanReviews.scanRunId, scanRunId),
				eq(scanReviews.status, "running"),
			),
			orderBy: [desc(scanReviews.createdAt), desc(scanReviews.id)],
		});
		return (
			rows.find(
				(row) => row.inputBundle?.generationKind === "improvement_request",
			) ?? null
		);
	}

	async listRunningImprovementRequests() {
		const rows = await this.db.query.scanReviews.findMany({
			where: eq(scanReviews.status, "running"),
			orderBy: [desc(scanReviews.createdAt), desc(scanReviews.id)],
		});
		return rows.filter(
			(row) => row.inputBundle?.generationKind === "improvement_request",
		);
	}
}
