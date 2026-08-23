import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { type AppDatabase, writerClientForDatabase } from "../../db";
import {
	projects,
	scanEvents,
	scanExecutionPlans,
	scanRuns,
	toolRuns,
} from "../../db/schema";

export { ArtifactRepository } from "./execution/lifecycle/artifact-repository";
export { FindingRepository } from "./findings/finding-repository";

/**
 * SQLite evaluates the nested json_set calls in one UPDATE statement, keeping
 * the metadata merge atomic. json_patch cannot be used here: RFC 7396 treats
 * nested nulls as delete instructions and corrupted persisted preflight data.
 */
function mergeJsonMetadata(metadata: Record<string, unknown>) {
	let merged = sql`COALESCE(${scanRuns.metadata}, '{}')`;
	for (const [key, value] of Object.entries(metadata)) {
		const serialized = JSON.stringify(value);
		if (serialized === undefined) continue;
		const path = `$.${JSON.stringify(key)}`;
		merged = sql`json_set(${merged}, ${path}, json(${serialized}))`;
	}
	return merged;
}

export class ProjectRepository {
	constructor(private readonly db: AppDatabase) {}

	async createProject(params: {
		ownerUserId: string;
		name: string;
		repoPath: string;
		defaultBranch?: string;
		metadata?: Record<string, unknown>;
		canonicalRepoPath?: string;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(projects)
			.values({
				ownerUserId: params.ownerUserId,
				name: params.name,
				repoPath: params.repoPath,
				canonicalRepoPath: params.canonicalRepoPath ?? params.repoPath,
				defaultBranch: params.defaultBranch ?? "main",
				metadata: params.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async findById(id: string) {
		return (
			(await this.db.query.projects.findFirst({
				where: eq(projects.id, id),
			})) ?? null
		);
	}

	async findByRepoPath(ownerUserId: string, repoPath: string) {
		return (
			(await this.db.query.projects.findFirst({
				where: and(
					eq(projects.ownerUserId, ownerUserId),
					eq(projects.repoPath, repoPath),
				),
			})) ?? null
		);
	}

	async findAnyByRepoPath(repoPath: string) {
		return (
			(await this.db.query.projects.findFirst({
				where: eq(projects.repoPath, repoPath),
			})) ?? null
		);
	}

	async findByCanonicalRepoPath(canonicalRepoPath: string) {
		return (
			(await this.db.query.projects.findFirst({
				where: eq(projects.canonicalRepoPath, canonicalRepoPath),
			})) ?? null
		);
	}

	async setCanonicalRepoPath(id: string, canonicalRepoPath: string) {
		const [updated] = await this.db
			.update(projects)
			.set({
				canonicalRepoPath,
				repoPath: canonicalRepoPath,
				updatedAt: new Date(),
			})
			.where(eq(projects.id, id))
			.returning();
		return updated ?? null;
	}

	async listProjects(ownerUserId: string) {
		return await this.db.query.projects.findMany({
			where: eq(projects.ownerUserId, ownerUserId),
		});
	}
}

export class ScanRepository {
	constructor(private readonly db: AppDatabase) {}

	async createScanRun(params: {
		projectId: string;
		profile: string;
		status: string;
		createdByUserId?: string | null;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanRuns)
			.values({
				projectId: params.projectId,
				profile: params.profile,
				status: params.status,
				profileOutcome: params.status === "queued" ? "pending" : "running",
				createdByUserId: params.createdByUserId ?? null,
				startedAt: params.status === "queued" ? null : now,
				metadata: params.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async claimQueuedScanRun(params: {
		id: string;
		projectId: string;
		profile: string;
		metadata?: Record<string, unknown>;
	}) {
		const existing = await this.findById(params.id);
		if (!existing) return null;
		if (
			existing.projectId !== params.projectId ||
			existing.profile !== params.profile
		) {
			throw new Error("Queued scan identity does not match project/profile.");
		}
		const now = new Date();
		const [claimed] = await this.db
			.update(scanRuns)
			.set({
				status: "running",
				startedAt: now,
				updatedAt: now,
				metadata: mergeJsonMetadata(params.metadata ?? {}),
			})
			.where(and(eq(scanRuns.id, params.id), eq(scanRuns.status, "queued")))
			.returning();
		return claimed ?? null;
	}

	async mergeScanRunMetadata(id: string, metadata: Record<string, unknown>) {
		const [updated] = await this.db
			.update(scanRuns)
			.set({
				metadata: mergeJsonMetadata(metadata),
				updatedAt: new Date(),
			})
			.where(eq(scanRuns.id, id))
			.returning();
		return updated ?? null;
	}

	async saveExecutionPlan(params: {
		scanRunId: string;
		projectId: string;
		profileId: string;
		strictness: "strict" | "best_effort";
		planHash: string;
		plan: Record<string, unknown>;
	}) {
		if (
			params.plan.scanRunId !== params.scanRunId ||
			params.plan.projectId !== params.projectId ||
			params.plan.profileId !== params.profileId ||
			params.plan.strictness !== params.strictness ||
			params.plan.planHash !== params.planHash
		) {
			throw new Error("scan_execution_plan_identity_mismatch");
		}
		const [saved] = await this.db
			.insert(scanExecutionPlans)
			.values({
				scanRunId: params.scanRunId,
				projectId: params.projectId,
				profileId: params.profileId,
				strictness: params.strictness,
				planHash: params.planHash,
				plan: params.plan,
				createdAt: new Date(),
			})
			.onConflictDoNothing({ target: scanExecutionPlans.scanRunId })
			.returning();
		if (saved) return saved;
		const existing =
			(await this.db.query.scanExecutionPlans.findFirst({
				where: eq(scanExecutionPlans.scanRunId, params.scanRunId),
			})) ?? null;
		if (
			!existing ||
			existing.projectId !== params.projectId ||
			existing.profileId !== params.profileId ||
			existing.strictness !== params.strictness ||
			existing.planHash !== params.planHash
		) {
			throw new Error("scan_execution_plan_immutable_conflict");
		}
		return existing;
	}

	async getExecutionPlan(scanRunId: string) {
		return (
			(await this.db.query.scanExecutionPlans.findFirst({
				where: eq(scanExecutionPlans.scanRunId, scanRunId),
			})) ?? null
		);
	}

	async listActiveScanRuns() {
		return await this.db.query.scanRuns.findMany({
			where: or(eq(scanRuns.status, "queued"), eq(scanRuns.status, "running")),
		});
	}

	async updateScanRunStatus(
		id: string,
		status: string,
		options?: {
			summary?: string | null;
			completedAt?: Date | null;
			metadata?: Record<string, unknown>;
			profileOutcome?:
				| "pending"
				| "running"
				| "completed"
				| "completed_with_warnings"
				| "blocked"
				| "incomplete"
				| "failed";
			returnNullIfNotUpdated?: boolean;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: now,
		};
		if (options?.summary !== undefined) {
			updateValues.summary = options.summary;
		}
		if (options?.completedAt !== undefined) {
			updateValues.completedAt = options.completedAt;
		} else if (
			status === "completed" ||
			status === "failed" ||
			status === "cancelled"
		) {
			updateValues.completedAt = now;
		}
		if (options?.metadata !== undefined) {
			updateValues.metadata = mergeJsonMetadata(options.metadata);
		}
		if (options?.profileOutcome !== undefined) {
			updateValues.profileOutcome = options.profileOutcome;
		}

		const terminalStatuses = ["completed", "failed", "cancelled"];
		const transitionGuard = terminalStatuses.includes(status)
			? and(
					eq(scanRuns.id, id),
					inArray(scanRuns.status, ["queued", "running"]),
				)
			: status === "running" || status === "queued"
				? and(
						eq(scanRuns.id, id),
						inArray(scanRuns.status, ["queued", "running"]),
					)
				: eq(scanRuns.id, id);
		const [updated] = await this.db
			.update(scanRuns)
			.set(updateValues)
			.where(transitionGuard)
			.returning();
		return (
			updated ??
			(options?.returnNullIfNotUpdated ? null : await this.findById(id))
		);
	}

	async findById(id: string) {
		return (
			(await this.db.query.scanRuns.findFirst({
				where: eq(scanRuns.id, id),
			})) ?? null
		);
	}

	async listScanRuns(projectId: string) {
		return await this.listScanRunsByProject(projectId);
	}

	async listScanRunsByProject(projectId: string) {
		return await this.db.query.scanRuns.findMany({
			where: eq(scanRuns.projectId, projectId),
			orderBy: (fields, { desc }) => [desc(fields.createdAt), desc(fields.id)],
		});
	}

	async createScanEvent(params: {
		scanRunId: string;
		level: "debug" | "info" | "warn" | "error";
		eventType: string;
		message: string;
		data?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(scanEvents)
			.values({
				scanRunId: params.scanRunId,
				level: params.level,
				eventType: params.eventType,
				message: params.message,
				data: params.data ?? {},
				createdAt: now,
			})
			.returning();
		if (!created) return created;
		return (
			(await this.db.query.scanEvents.findFirst({
				where: eq(scanEvents.id, created.id),
			})) ?? created
		);
	}

	async listScanEvents(scanRunId: string) {
		return await this.db.query.scanEvents.findMany({
			where: eq(scanEvents.scanRunId, scanRunId),
			orderBy: [asc(scanEvents.seq)],
		});
	}

	async listScanEventsAfter(
		scanRunId: string,
		afterSeq: number,
		limit: number,
	) {
		return await this.db.query.scanEvents.findMany({
			where: and(
				eq(scanEvents.scanRunId, scanRunId),
				gt(scanEvents.seq, afterSeq),
			),
			orderBy: [asc(scanEvents.seq)],
			limit,
		});
	}

	async createToolRun(params: {
		scanRunId: string;
		toolName: string;
		toolVersion?: string | null;
		command?: string | null;
		status: string;
		exitCode?: number | null;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(toolRuns)
			.values({
				scanRunId: params.scanRunId,
				toolName: params.toolName,
				toolVersion: params.toolVersion ?? null,
				command: params.command ?? null,
				status: params.status,
				exitCode: params.exitCode ?? null,
				startedAt: now,
				metadata: params.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateToolRunStatus(
		id: string,
		status: string,
		options?: {
			exitCode?: number | null;
			toolVersion?: string | null;
			metadata?: Record<string, unknown>;
			completedAt?: Date | null;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: now,
		};
		if (options?.exitCode !== undefined) {
			updateValues.exitCode = options.exitCode;
		}
		if (options?.toolVersion !== undefined) {
			updateValues.toolVersion = options.toolVersion;
		}
		if (options?.metadata !== undefined) {
			updateValues.metadata = options.metadata;
		}
		if (options?.completedAt !== undefined) {
			updateValues.completedAt = options.completedAt;
		} else if (status === "completed" || status === "failed") {
			updateValues.completedAt = now;
		}

		const [updated] = await this.db
			.update(toolRuns)
			.set(updateValues)
			.where(eq(toolRuns.id, id))
			.returning();
		return updated || null;
	}

	async recordToolUnavailable(params: {
		scanRunId: string;
		toolRunId: string;
		toolName: string;
		message: string;
		metadata: Record<string, unknown>;
	}): Promise<void> {
		const now = new Date();
		const eventQuery = this.db.insert(scanEvents).values({
			scanRunId: params.scanRunId,
			level: "error",
			eventType: "tool.failed",
			message: `${params.toolName} failed: ${params.message}`,
			data: { toolRunId: params.toolRunId },
			createdAt: now,
		});
		const toolRunQuery = this.db
			.update(toolRuns)
			.set({
				status: "failed",
				exitCode: 127,
				metadata: params.metadata,
				completedAt: now,
				updatedAt: now,
			})
			.where(eq(toolRuns.id, params.toolRunId));
		const writer = writerClientForDatabase(this.db);
		if (writer) {
			await writer.atomicDrizzleBatch([eventQuery, toolRunQuery]);
			return;
		}
		await eventQuery;
		await toolRunQuery;
	}
}
