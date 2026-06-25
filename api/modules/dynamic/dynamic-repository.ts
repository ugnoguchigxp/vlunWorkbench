import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	dynamicArtifacts,
	dynamicEvidence,
	dynamicProfileConfigs,
	dynamicRuns,
} from "../../db/schema";

export class DynamicRepository {
	constructor(private readonly db: AppDatabase) {}

	// --- Profile Configs ---

	async createConfig(params: {
		projectId: string;
		profileId: string;
		dynamicKind: "test" | "sanitizer" | "fuzz";
		displayName: string;
		enabled?: boolean;
		commandJson: string[];
		workingDirectory?: string;
		timeoutSec?: number;
		network?: string;
		memory?: string | null;
		cpus?: string | null;
		writableWorkdir?: boolean;
		allowProjectScripts?: boolean;
		expectedArtifactsJson?: string[];
		metadata?: Record<string, unknown>;
		createdByUserId?: string | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(dynamicProfileConfigs)
			.values({
				projectId: params.projectId,
				profileId: params.profileId,
				dynamicKind: params.dynamicKind,
				displayName: params.displayName,
				enabled: params.enabled ?? true,
				commandJson: params.commandJson,
				workingDirectory: params.workingDirectory ?? "",
				timeoutSec: params.timeoutSec ?? 120,
				network: params.network ?? "none",
				memory: params.memory ?? null,
				cpus: params.cpus ?? null,
				writableWorkdir: params.writableWorkdir ?? false,
				allowProjectScripts: params.allowProjectScripts ?? false,
				expectedArtifactsJson: params.expectedArtifactsJson ?? [],
				metadata: params.metadata ?? {},
				createdByUserId: params.createdByUserId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateConfig(
		id: string,
		params: {
			displayName?: string;
			enabled?: boolean;
			commandJson?: string[];
			workingDirectory?: string;
			timeoutSec?: number;
			network?: string;
			memory?: string | null;
			cpus?: string | null;
			writableWorkdir?: boolean;
			allowProjectScripts?: boolean;
			expectedArtifactsJson?: string[];
			metadata?: Record<string, unknown>;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			updatedAt: now,
		};
		if (params.displayName !== undefined)
			updateValues.displayName = params.displayName;
		if (params.enabled !== undefined) updateValues.enabled = params.enabled;
		if (params.commandJson !== undefined)
			updateValues.commandJson = params.commandJson;
		if (params.workingDirectory !== undefined)
			updateValues.workingDirectory = params.workingDirectory;
		if (params.timeoutSec !== undefined)
			updateValues.timeoutSec = params.timeoutSec;
		if (params.network !== undefined) updateValues.network = params.network;
		if (params.memory !== undefined) updateValues.memory = params.memory;
		if (params.cpus !== undefined) updateValues.cpus = params.cpus;
		if (params.writableWorkdir !== undefined)
			updateValues.writableWorkdir = params.writableWorkdir;
		if (params.allowProjectScripts !== undefined)
			updateValues.allowProjectScripts = params.allowProjectScripts;
		if (params.expectedArtifactsJson !== undefined)
			updateValues.expectedArtifactsJson = params.expectedArtifactsJson;
		if (params.metadata !== undefined) updateValues.metadata = params.metadata;

		const [updated] = await this.db
			.update(dynamicProfileConfigs)
			.set(updateValues)
			.where(eq(dynamicProfileConfigs.id, id))
			.returning();
		return updated || null;
	}

	async getConfig(id: string) {
		return (
			(await this.db.query.dynamicProfileConfigs.findFirst({
				where: eq(dynamicProfileConfigs.id, id),
			})) ?? null
		);
	}

	async getConfigByProfileId(projectId: string, profileId: string) {
		return (
			(await this.db.query.dynamicProfileConfigs.findFirst({
				where: and(
					eq(dynamicProfileConfigs.projectId, projectId),
					eq(dynamicProfileConfigs.profileId, profileId),
				),
			})) ?? null
		);
	}

	async listConfigsForProject(projectId: string) {
		return await this.db.query.dynamicProfileConfigs.findMany({
			where: eq(dynamicProfileConfigs.projectId, projectId),
			orderBy: (configs, { desc }) => [desc(configs.createdAt)],
		});
	}

	async deleteConfig(id: string) {
		const [deleted] = await this.db
			.delete(dynamicProfileConfigs)
			.where(eq(dynamicProfileConfigs.id, id))
			.returning();
		return deleted || null;
	}

	// --- Dynamic Runs ---

	async createRun(params: {
		projectId: string;
		scanRunId?: string | null;
		findingId?: string | null;
		profileConfigId: string;
		profileId: string;
		dynamicKind: "test" | "sanitizer" | "fuzz";
		status: string;
		runner: string;
		commandJson: string[];
		createdByUserId?: string | null;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(dynamicRuns)
			.values({
				projectId: params.projectId,
				scanRunId: params.scanRunId ?? null,
				findingId: params.findingId ?? null,
				profileConfigId: params.profileConfigId,
				profileId: params.profileId,
				dynamicKind: params.dynamicKind,
				status: params.status,
				runner: params.runner,
				commandJson: params.commandJson,
				startedAt: now,
				metadata: params.metadata ?? {},
				createdByUserId: params.createdByUserId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateRunStatus(
		id: string,
		status: string,
		options?: {
			outcome?: string | null;
			exitCode?: number | null;
			completedAt?: Date | null;
			summary?: string | null;
			errorMessage?: string | null;
			metadata?: Record<string, unknown>;
		},
	) {
		const now = new Date();
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: now,
		};
		if (options?.outcome !== undefined) updateValues.outcome = options.outcome;
		if (options?.exitCode !== undefined)
			updateValues.exitCode = options.exitCode;
		if (options?.summary !== undefined) updateValues.summary = options.summary;
		if (options?.errorMessage !== undefined)
			updateValues.errorMessage = options.errorMessage;
		if (options?.metadata !== undefined)
			updateValues.metadata = options.metadata;

		if (options?.completedAt !== undefined) {
			updateValues.completedAt = options.completedAt;
		} else if (
			status === "completed" ||
			status === "failed" ||
			status === "timed_out" ||
			status === "cancelled"
		) {
			updateValues.completedAt = now;
		}

		const [updated] = await this.db
			.update(dynamicRuns)
			.set(updateValues)
			.where(eq(dynamicRuns.id, id))
			.returning();
		return updated || null;
	}

	async getRun(id: string) {
		return (
			(await this.db.query.dynamicRuns.findFirst({
				where: eq(dynamicRuns.id, id),
			})) ?? null
		);
	}

	async listRunsForProject(projectId: string) {
		return await this.db.query.dynamicRuns.findMany({
			where: eq(dynamicRuns.projectId, projectId),
			orderBy: (runs, { desc }) => [desc(runs.createdAt)],
		});
	}

	async listRunsForFinding(findingId: string) {
		return await this.db.query.dynamicRuns.findMany({
			where: eq(dynamicRuns.findingId, findingId),
			orderBy: (runs, { desc }) => [desc(runs.createdAt)],
		});
	}

	// --- Dynamic Artifacts ---

	async createArtifact(params: {
		dynamicRunId: string;
		projectId: string;
		findingId?: string | null;
		kind: string;
		format: string;
		path: string;
		sha256: string;
		sizeBytes: number;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(dynamicArtifacts)
			.values({
				dynamicRunId: params.dynamicRunId,
				projectId: params.projectId,
				findingId: params.findingId ?? null,
				kind: params.kind,
				format: params.format,
				path: params.path,
				sha256: params.sha256,
				sizeBytes: params.sizeBytes,
				metadata: params.metadata ?? {},
				createdAt: now,
			})
			.returning();
		return created;
	}

	async listArtifacts(dynamicRunId: string) {
		return await this.db.query.dynamicArtifacts.findMany({
			where: eq(dynamicArtifacts.dynamicRunId, dynamicRunId),
		});
	}

	async getArtifact(id: string) {
		return (
			(await this.db.query.dynamicArtifacts.findFirst({
				where: eq(dynamicArtifacts.id, id),
			})) ?? null
		);
	}

	// --- Dynamic Evidence ---

	async createEvidence(params: {
		dynamicRunId: string;
		projectId: string;
		findingId?: string | null;
		kind: string;
		title: string;
		artifactId?: string | null;
		location?: Record<string, unknown> | null;
		snippet?: string | null;
		metadata?: Record<string, unknown>;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(dynamicEvidence)
			.values({
				dynamicRunId: params.dynamicRunId,
				projectId: params.projectId,
				findingId: params.findingId ?? null,
				kind: params.kind,
				title: params.title,
				artifactId: params.artifactId ?? null,
				location: params.location ?? null,
				snippet: params.snippet ?? null,
				metadata: params.metadata ?? {},
				createdAt: now,
			})
			.returning();
		return created;
	}

	async listEvidence(dynamicRunId: string) {
		return await this.db.query.dynamicEvidence.findMany({
			where: eq(dynamicEvidence.dynamicRunId, dynamicRunId),
		});
	}

	async listEvidenceForFinding(findingId: string) {
		return await this.db.query.dynamicEvidence.findMany({
			where: eq(dynamicEvidence.findingId, findingId),
			orderBy: (ev, { desc }) => [desc(ev.createdAt)],
		});
	}
}
