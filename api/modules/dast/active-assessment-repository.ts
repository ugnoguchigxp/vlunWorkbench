import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	activeAssessmentEvidences,
	activeAssessmentRuns,
	scanRuns,
} from "../../db/schema";

export class ActiveAssessmentRepository {
	constructor(private readonly db: AppDatabase) {}

	async createRun(input: {
		projectId: string;
		scanRunId: string;
		engagementId: string;
		targetConfigId: string;
		kind: "transaction" | "authorization_matrix" | "zap_active";
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

	async sumEngagementRequestCount(engagementId: string): Promise<number> {
		const [row] = await this.db
			.select({
				total: sql<number>`coalesce(sum(${activeAssessmentRuns.requestCount}), 0)`,
			})
			.from(activeAssessmentRuns)
			.where(eq(activeAssessmentRuns.engagementId, engagementId));
		return Number(row?.total ?? 0);
	}

	async failInterruptedRuns(): Promise<number> {
		const interrupted = await this.db.query.activeAssessmentRuns.findMany({
			where: eq(activeAssessmentRuns.status, "running"),
		});
		for (const run of interrupted) {
			const [evidenceCount] = await this.db
				.select({
					count: sql<number>`count(*)`,
				})
				.from(activeAssessmentEvidences)
				.where(eq(activeAssessmentEvidences.activeAssessmentRunId, run.id));
			const now = new Date();
			const interruptedStatus =
				run.kind === "authorization_matrix" ? "inconclusive" : "failed_cleanup";
			const limitationCode =
				run.kind === "authorization_matrix"
					? "interrupted_readonly_matrix"
					: "interrupted_cleanup_state_unknown";
			await this.db
				.update(activeAssessmentRuns)
				.set({
					status: interruptedStatus,
					requestCount: Number(evidenceCount?.count ?? run.requestCount),
					summary:
						run.kind === "authorization_matrix"
							? "Read-only authorization matrix was interrupted."
							: "Active assessment was interrupted; cleanup state is unknown.",
					result: {
						limitationCodes: [limitationCode],
					},
					errorMessage: limitationCode,
					completedAt: now,
					updatedAt: now,
				})
				.where(eq(activeAssessmentRuns.id, run.id));
			await this.db
				.update(scanRuns)
				.set({
					status: "failed",
					summary:
						"Active assessment interrupted; cleanup state requires investigation.",
					completedAt: now,
					updatedAt: now,
				})
				.where(eq(scanRuns.id, run.scanRunId));
		}
		return interrupted.length;
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
