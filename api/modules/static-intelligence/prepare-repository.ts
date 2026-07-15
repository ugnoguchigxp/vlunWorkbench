import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { staticIntelligencePrepareJobs } from "../../db/schema";

export type PrepareJobStatus =
	| "requested"
	| "queued"
	| "running"
	| "ready"
	| "failed";

export type PrepareJobStage =
	| "resolving_project"
	| "checking_freshness"
	| "structure_scan"
	| "security_scan"
	| "generation_build"
	| "publishing"
	| "complete";

export class StaticIntelligencePrepareRepository {
	constructor(private readonly db: AppDatabase) {}

	async findById(id: string) {
		return (
			(await this.db.query.staticIntelligencePrepareJobs.findFirst({
				where: eq(staticIntelligencePrepareJobs.id, id),
			})) ?? null
		);
	}

	async findActive(projectId: string, sourceFingerprint: string) {
		return (
			(await this.db.query.staticIntelligencePrepareJobs.findFirst({
				where: and(
					eq(staticIntelligencePrepareJobs.projectId, projectId),
					eq(
						staticIntelligencePrepareJobs.sourceFingerprint,
						sourceFingerprint,
					),
					inArray(staticIntelligencePrepareJobs.status, [
						"requested",
						"queued",
						"running",
					]),
				),
				orderBy: [desc(staticIntelligencePrepareJobs.updatedAt)],
			})) ?? null
		);
	}

	async findReady(projectId: string, sourceFingerprint: string) {
		return (
			(await this.db.query.staticIntelligencePrepareJobs.findFirst({
				where: and(
					eq(staticIntelligencePrepareJobs.projectId, projectId),
					eq(
						staticIntelligencePrepareJobs.sourceFingerprint,
						sourceFingerprint,
					),
					eq(staticIntelligencePrepareJobs.status, "ready"),
				),
				orderBy: [desc(staticIntelligencePrepareJobs.updatedAt)],
			})) ?? null
		);
	}

	async findLatest(projectId: string) {
		return (
			(await this.db.query.staticIntelligencePrepareJobs.findFirst({
				where: eq(staticIntelligencePrepareJobs.projectId, projectId),
				orderBy: [desc(staticIntelligencePrepareJobs.updatedAt)],
			})) ?? null
		);
	}

	async listRecoverable(now = new Date()) {
		return await this.db.query.staticIntelligencePrepareJobs.findMany({
			where: or(
				inArray(staticIntelligencePrepareJobs.status, ["requested", "queued"]),
				and(
					eq(staticIntelligencePrepareJobs.status, "running"),
					or(
						isNull(staticIntelligencePrepareJobs.leaseExpiresAt),
						lte(staticIntelligencePrepareJobs.leaseExpiresAt, now),
					),
				),
			),
			orderBy: [asc(staticIntelligencePrepareJobs.createdAt)],
		});
	}

	async create(params: {
		projectId: string;
		canonicalProjectPath: string;
		sourceFingerprint: string;
		status?: PrepareJobStatus;
		stage?: PrepareJobStage;
		scanRunId?: string;
		generationId?: string;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(staticIntelligencePrepareJobs)
			.values({
				projectId: params.projectId,
				canonicalProjectPath: params.canonicalProjectPath,
				sourceFingerprint: params.sourceFingerprint,
				status: params.status ?? "requested",
				stage: params.stage ?? "checking_freshness",
				scanRunId: params.scanRunId ?? null,
				generationId: params.generationId ?? null,
				attemptCount: 0,
				createdAt: now,
				updatedAt: now,
				completedAt: params.status === "ready" ? now : null,
			})
			.returning();
		return created;
	}

	async attachQueuedScan(id: string, scanRunId: string) {
		return await this.update(id, {
			status: "queued",
			stage: "structure_scan",
			scanRunId,
		});
	}

	async claim(id: string, leaseMs = 15 * 60_000) {
		const now = new Date();
		const [claimed] = await this.db
			.update(staticIntelligencePrepareJobs)
			.set({
				status: "running",
				startedAt: now,
				updatedAt: now,
				leaseExpiresAt: new Date(now.getTime() + leaseMs),
				attemptCount: sql`${staticIntelligencePrepareJobs.attemptCount} + 1`,
				errorCode: null,
				errorMessageRedacted: null,
				retryable: null,
			})
			.where(
				and(
					eq(staticIntelligencePrepareJobs.id, id),
					or(
						inArray(staticIntelligencePrepareJobs.status, [
							"requested",
							"queued",
						]),
						and(
							eq(staticIntelligencePrepareJobs.status, "running"),
							lte(staticIntelligencePrepareJobs.leaseExpiresAt, now),
						),
					),
				),
			)
			.returning();
		return claimed ?? null;
	}

	async update(
		id: string,
		values: Partial<{
			status: PrepareJobStatus;
			stage: PrepareJobStage;
			scanRunId: string | null;
			generationId: string | null;
			errorCode: string | null;
			errorMessageRedacted: string | null;
			retryable: boolean | null;
			leaseExpiresAt: Date | null;
			completedAt: Date | null;
		}>,
	) {
		const [updated] = await this.db
			.update(staticIntelligencePrepareJobs)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(staticIntelligencePrepareJobs.id, id))
			.returning();
		return updated ?? null;
	}
}
