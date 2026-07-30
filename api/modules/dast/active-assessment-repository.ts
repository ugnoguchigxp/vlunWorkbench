import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	activeAssessmentEvidences,
	activeAssessmentRuns,
} from "../../db/schema";

export class ActiveAssessmentRepository {
	constructor(private readonly db: AppDatabase) {}

	async createRun(input: {
		projectId: string;
		scanRunId: string;
		engagementId: string;
		targetConfigId: string;
		kind: "transaction" | "authorization_matrix";
		createdByUserId: string | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(activeAssessmentRuns)
			.values({
				...input,
				status: "running",
				startedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async completeRun(
		id: string,
		input: {
			status: "completed" | "inconclusive" | "failed_cleanup" | "failed";
			requestCount: number;
			findingCount: number;
			summary: string;
			result: Record<string, unknown>;
			errorMessage?: string | null;
		},
	) {
		const [updated] = await this.db
			.update(activeAssessmentRuns)
			.set({
				...input,
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(activeAssessmentRuns.id, id))
			.returning();
		return updated ?? null;
	}

	async createEvidence(input: {
		activeAssessmentRunId: string;
		method: string;
		path: string;
		statusCode: number | null;
		identityRole: string | null;
		stage: string;
		requestSha256: string;
		durationMs: number;
		errorCode?: string | null;
	}) {
		const [created] = await this.db
			.insert(activeAssessmentEvidences)
			.values({ ...input, createdAt: new Date() })
			.returning();
		return created;
	}

	async listRuns(projectId: string, createdByUserId: string) {
		return await this.db.query.activeAssessmentRuns.findMany({
			where: and(
				eq(activeAssessmentRuns.projectId, projectId),
				eq(activeAssessmentRuns.createdByUserId, createdByUserId),
			),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
	}

	async findOwnedRun(id: string, projectId: string, createdByUserId: string) {
		return (
			(await this.db.query.activeAssessmentRuns.findFirst({
				where: and(
					eq(activeAssessmentRuns.id, id),
					eq(activeAssessmentRuns.projectId, projectId),
					eq(activeAssessmentRuns.createdByUserId, createdByUserId),
				),
			})) ?? null
		);
	}

	async listEvidence(activeAssessmentRunId: string) {
		return await this.db.query.activeAssessmentEvidences.findMany({
			where: eq(
				activeAssessmentEvidences.activeAssessmentRunId,
				activeAssessmentRunId,
			),
			orderBy: (fields, { asc }) => [asc(fields.createdAt)],
		});
	}
}
