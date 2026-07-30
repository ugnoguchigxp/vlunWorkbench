import { and, eq, sql } from "drizzle-orm";
import type { BusinessLogicScenario } from "../../../shared/schemas/business-logic.schema";
import type { AppDatabase } from "../../db";
import {
	applicationModelSnapshots,
	businessLogicEvidences,
	businessLogicRuns,
	businessLogicScenarios,
	scanRuns,
	threatHypotheses,
	threatModelRuns,
} from "../../db/schema";

export class BusinessLogicRepository {
	constructor(private readonly db: AppDatabase) {}

	async findOwnedHypothesis(
		projectId: string,
		ownerUserId: string,
		externalId: string,
	) {
		const [row] = await this.db
			.select({
				record: threatHypotheses,
				snapshot: applicationModelSnapshots,
			})
			.from(threatHypotheses)
			.innerJoin(
				threatModelRuns,
				eq(threatModelRuns.id, threatHypotheses.runId),
			)
			.innerJoin(
				applicationModelSnapshots,
				eq(applicationModelSnapshots.id, threatHypotheses.modelSnapshotId),
			)
			.where(
				and(
					eq(threatModelRuns.projectId, projectId),
					eq(threatModelRuns.ownerUserId, ownerUserId),
					eq(threatHypotheses.externalId, externalId),
				),
			)
			.limit(1);
		return row ?? null;
	}

	async saveScenario(params: {
		projectId: string;
		ownerUserId: string;
		hypothesisRecordId: string;
		scenario: BusinessLogicScenario;
		planHash: string;
	}) {
		await this.db
			.insert(businessLogicScenarios)
			.values({
				projectId: params.projectId,
				ownerUserId: params.ownerUserId,
				hypothesisId: params.hypothesisRecordId,
				engagementId: params.scenario.engagementId,
				targetConfigId: params.scenario.targetConfigId,
				controlId: params.scenario.controlId,
				planHash: params.planHash,
				scenario: params.scenario,
			})
			.onConflictDoNothing({ target: businessLogicScenarios.planHash });
		return await this.db.query.businessLogicScenarios.findFirst({
			where: and(
				eq(businessLogicScenarios.planHash, params.planHash),
				eq(businessLogicScenarios.ownerUserId, params.ownerUserId),
			),
		});
	}

	async findOwnedScenario(id: string, ownerUserId: string) {
		return (
			(await this.db.query.businessLogicScenarios.findFirst({
				where: and(
					eq(businessLogicScenarios.id, id),
					eq(businessLogicScenarios.ownerUserId, ownerUserId),
				),
			})) ?? null
		);
	}

	async listOwnedScenarios(projectId: string, ownerUserId: string) {
		return await this.db.query.businessLogicScenarios.findMany({
			where: and(
				eq(businessLogicScenarios.projectId, projectId),
				eq(businessLogicScenarios.ownerUserId, ownerUserId),
			),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
	}

	async createRun(params: {
		scenarioId: string;
		projectId: string;
		scanRunId: string;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(businessLogicRuns)
			.values({ ...params, status: "running", startedAt: now })
			.returning();
		return created;
	}

	async hasUnresolvedCleanup(projectId: string): Promise<boolean> {
		return Boolean(
			await this.db.query.businessLogicRuns.findFirst({
				where: and(
					eq(businessLogicRuns.projectId, projectId),
					eq(businessLogicRuns.status, "failed_cleanup"),
				),
			}),
		);
	}

	async failInterruptedRuns(): Promise<number> {
		const interrupted = await this.db.query.businessLogicRuns.findMany({
			where: eq(businessLogicRuns.status, "running"),
		});
		for (const run of interrupted) {
			const [evidenceCount] = await this.db
				.select({ count: sql<number>`count(*)` })
				.from(businessLogicEvidences)
				.where(eq(businessLogicEvidences.runId, run.id));
			const now = new Date();
			await this.db
				.update(businessLogicRuns)
				.set({
					status: "failed_cleanup",
					requestCount: Number(evidenceCount?.count ?? run.requestCount),
					cleanupSucceeded: false,
					result: {
						limitationCodes: ["interrupted_cleanup_state_unknown"],
					},
					errorCode: "interrupted_cleanup_state_unknown",
					completedAt: now,
					updatedAt: now,
				})
				.where(eq(businessLogicRuns.id, run.id));
			await this.db
				.update(scanRuns)
				.set({
					status: "failed",
					summary:
						"Business logic assessment interrupted; cleanup state is unknown.",
					completedAt: now,
					updatedAt: now,
				})
				.where(eq(scanRuns.id, run.scanRunId));
		}
		return interrupted.length;
	}

	async completeRun(
		id: string,
		params: {
			status: string;
			requestCount: number;
			findingCount: number;
			cleanupSucceeded: boolean;
			baselineHash?: string | null;
			result: Record<string, unknown>;
			errorCode?: string | null;
		},
	) {
		const [updated] = await this.db
			.update(businessLogicRuns)
			.set({
				...params,
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(businessLogicRuns.id, id))
			.returning();
		return updated ?? null;
	}

	async createEvidence(params: {
		runId: string;
		stage: string;
		method: string;
		path: string;
		statusCode: number | null;
		requestSha256: string;
		durationMs: number;
		invariantId?: string | null;
		invariantObserved?: boolean | null;
		errorCode?: string | null;
	}) {
		const [created] = await this.db
			.insert(businessLogicEvidences)
			.values(params)
			.returning();
		return created;
	}

	async sumEngagementRequests(engagementId: string): Promise<number> {
		const [row] = await this.db
			.select({
				total: sql<number>`coalesce(sum(${businessLogicRuns.requestCount}), 0)`,
			})
			.from(businessLogicRuns)
			.innerJoin(
				businessLogicScenarios,
				eq(businessLogicScenarios.id, businessLogicRuns.scenarioId),
			)
			.where(eq(businessLogicScenarios.engagementId, engagementId));
		return Number(row?.total ?? 0);
	}

	async findRun(id: string) {
		const run = await this.db.query.businessLogicRuns.findFirst({
			where: eq(businessLogicRuns.id, id),
		});
		if (!run) return null;
		const evidence = await this.db.query.businessLogicEvidences.findMany({
			where: eq(businessLogicEvidences.runId, id),
			orderBy: (fields, { asc }) => [asc(fields.createdAt)],
		});
		return { run, evidence };
	}
}
