import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	dastArtifacts,
	dastEvidence,
	dastProfileConfigs,
	dastRouteInventory,
	dastRuns,
	dastTargetConfigs,
} from "../../db/schema";
import { normalizeDastOrigin } from "./target-validator";
import type {
	DastArtifactKind,
	DastCoverageStatus,
	DastCoverageSummary,
	DastEvidenceKind,
	DastKind,
	DastRouteInventoryEntry,
	DastVerdict,
} from "./types";

export class DastRepository {
	constructor(private readonly db: AppDatabase) {}

	async createTargetConfig(params: {
		projectId: string;
		name: string;
		origin: string;
		enabled?: boolean;
		allowLoopback?: boolean;
		allowPrivateNetwork?: boolean;
		allowedPathsJson?: string[];
		excludedPathsJson?: string[];
		defaultHeadersJson?: Record<string, string>;
		maxDepth?: number;
		maxRequests?: number;
		rateLimitPerSec?: number;
		timeoutSec?: number;
		metadata?: Record<string, unknown>;
		createdByUserId?: string | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(dastTargetConfigs)
			.values({
				projectId: params.projectId,
				name: params.name,
				origin: params.origin,
				normalizedOrigin: normalizeDastOrigin(params.origin),
				enabled: params.enabled ?? true,
				allowLoopback: params.allowLoopback ?? true,
				allowPrivateNetwork: params.allowPrivateNetwork ?? false,
				allowedPathsJson: params.allowedPathsJson ?? ["/"],
				excludedPathsJson: params.excludedPathsJson ?? [],
				defaultHeadersJson: params.defaultHeadersJson ?? {},
				maxDepth: params.maxDepth ?? 0,
				maxRequests: params.maxRequests ?? 20,
				rateLimitPerSec: params.rateLimitPerSec ?? 2,
				timeoutSec: params.timeoutSec ?? 120,
				metadata: params.metadata ?? {},
				createdByUserId: params.createdByUserId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateTargetConfig(
		id: string,
		params: Partial<{
			name: string;
			origin: string;
			enabled: boolean;
			allowLoopback: boolean;
			allowPrivateNetwork: boolean;
			allowedPathsJson: string[];
			excludedPathsJson: string[];
			defaultHeadersJson: Record<string, string>;
			maxDepth: number;
			maxRequests: number;
			rateLimitPerSec: number;
			timeoutSec: number;
			metadata: Record<string, unknown>;
		}>,
	) {
		const updateValues: Record<string, unknown> = { updatedAt: new Date() };
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) updateValues[key] = value;
		}
		if (params.origin !== undefined) {
			updateValues.normalizedOrigin = normalizeDastOrigin(params.origin);
		}
		const [updated] = await this.db
			.update(dastTargetConfigs)
			.set(updateValues)
			.where(eq(dastTargetConfigs.id, id))
			.returning();
		return updated ?? null;
	}

	async getTargetConfig(id: string) {
		return (
			(await this.db.query.dastTargetConfigs.findFirst({
				where: eq(dastTargetConfigs.id, id),
			})) ?? null
		);
	}

	async listTargetConfigsForProject(projectId: string) {
		return await this.db.query.dastTargetConfigs.findMany({
			where: eq(dastTargetConfigs.projectId, projectId),
			orderBy: (configs, { desc }) => [desc(configs.createdAt)],
		});
	}

	async createProfileConfig(params: {
		projectId: string;
		targetConfigId: string;
		profileId: string;
		displayName: string;
		enabled?: boolean;
		routePathsJson?: string[];
		formSelectorsJson?: string[];
		checkOptionsJson?: Record<string, unknown>;
		timeoutSec?: number | null;
		maxRequests?: number | null;
		metadata?: Record<string, unknown>;
		createdByUserId?: string | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(dastProfileConfigs)
			.values({
				projectId: params.projectId,
				targetConfigId: params.targetConfigId,
				profileId: params.profileId,
				displayName: params.displayName,
				enabled: params.enabled ?? true,
				routePathsJson: params.routePathsJson ?? [],
				formSelectorsJson: params.formSelectorsJson ?? [],
				checkOptionsJson: params.checkOptionsJson ?? {},
				timeoutSec: params.timeoutSec ?? null,
				maxRequests: params.maxRequests ?? null,
				metadata: params.metadata ?? {},
				createdByUserId: params.createdByUserId ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async updateProfileConfig(
		id: string,
		params: Partial<{
			targetConfigId: string;
			profileId: string;
			displayName: string;
			enabled: boolean;
			routePathsJson: string[];
			formSelectorsJson: string[];
			checkOptionsJson: Record<string, unknown>;
			timeoutSec: number | null;
			maxRequests: number | null;
			metadata: Record<string, unknown>;
		}>,
	) {
		const updateValues: Record<string, unknown> = { updatedAt: new Date() };
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) updateValues[key] = value;
		}
		const [updated] = await this.db
			.update(dastProfileConfigs)
			.set(updateValues)
			.where(eq(dastProfileConfigs.id, id))
			.returning();
		return updated ?? null;
	}

	async getProfileConfig(id: string) {
		return (
			(await this.db.query.dastProfileConfigs.findFirst({
				where: eq(dastProfileConfigs.id, id),
			})) ?? null
		);
	}

	async getProfileConfigForTarget(
		projectId: string,
		targetConfigId: string,
		profileId: string,
	) {
		return (
			(await this.db.query.dastProfileConfigs.findFirst({
				where: and(
					eq(dastProfileConfigs.projectId, projectId),
					eq(dastProfileConfigs.targetConfigId, targetConfigId),
					eq(dastProfileConfigs.profileId, profileId),
				),
			})) ?? null
		);
	}

	async listProfileConfigsForProject(projectId: string) {
		return await this.db.query.dastProfileConfigs.findMany({
			where: eq(dastProfileConfigs.projectId, projectId),
			orderBy: (configs, { desc }) => [desc(configs.createdAt)],
		});
	}

	async createRun(params: {
		projectId: string;
		scanRunId: string;
		targetConfigId: string;
		profileConfigId?: string | null;
		profileId: string;
		dastKind: DastKind;
		targetOrigin: string;
		runnerOrigin: string;
		status: string;
		outcome?: string | null;
		verdict?: DastVerdict | null;
		coverageStatus?: DastCoverageStatus | null;
		coverageSummary?: DastCoverageSummary;
		limitationCodes?: string[];
		policyId?: string | null;
		policyHash?: string | null;
		summary?: string | null;
		errorMessage?: string | null;
		metadata?: Record<string, unknown>;
		createdByUserId?: string | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(dastRuns)
			.values({
				projectId: params.projectId,
				scanRunId: params.scanRunId,
				targetConfigId: params.targetConfigId,
				profileConfigId: params.profileConfigId ?? null,
				profileId: params.profileId,
				dastKind: params.dastKind,
				targetOrigin: params.targetOrigin,
				runnerOrigin: params.runnerOrigin,
				status: params.status,
				outcome: params.outcome ?? null,
				verdict: params.verdict ?? null,
				coverageStatus: params.coverageStatus ?? null,
				coverageSummary: params.coverageSummary ?? {},
				limitationCodes: params.limitationCodes ?? [],
				policyId: params.policyId ?? null,
				policyHash: params.policyHash ?? null,
				startedAt: now,
				summary: params.summary ?? null,
				errorMessage: params.errorMessage ?? null,
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
			verdict?: DastVerdict | null;
			coverageStatus?: DastCoverageStatus | null;
			coverageSummary?: DastCoverageSummary;
			limitationCodes?: string[];
			policyId?: string | null;
			policyHash?: string | null;
			completedAt?: Date | null;
			summary?: string | null;
			errorMessage?: string | null;
			metadata?: Record<string, unknown>;
		},
	) {
		const updateValues: Record<string, unknown> = {
			status,
			updatedAt: new Date(),
		};
		if (options?.outcome !== undefined) updateValues.outcome = options.outcome;
		if (options?.verdict !== undefined) updateValues.verdict = options.verdict;
		if (options?.coverageStatus !== undefined)
			updateValues.coverageStatus = options.coverageStatus;
		if (options?.coverageSummary !== undefined)
			updateValues.coverageSummary = options.coverageSummary;
		if (options?.limitationCodes !== undefined)
			updateValues.limitationCodes = options.limitationCodes;
		if (options?.policyId !== undefined)
			updateValues.policyId = options.policyId;
		if (options?.policyHash !== undefined)
			updateValues.policyHash = options.policyHash;
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
			updateValues.completedAt = new Date();
		}
		const [updated] = await this.db
			.update(dastRuns)
			.set(updateValues)
			.where(eq(dastRuns.id, id))
			.returning();
		return updated ?? null;
	}

	async getRun(id: string) {
		return (
			(await this.db.query.dastRuns.findFirst({
				where: eq(dastRuns.id, id),
			})) ?? null
		);
	}

	async listRunsForProject(projectId: string) {
		return await this.db.query.dastRuns.findMany({
			where: eq(dastRuns.projectId, projectId),
			orderBy: (runs, { desc }) => [desc(runs.createdAt)],
		});
	}

	async replaceRouteInventory(params: {
		dastRunId: string;
		projectId: string;
		scanRunId: string;
		entries: DastRouteInventoryEntry[];
	}) {
		await this.db
			.delete(dastRouteInventory)
			.where(eq(dastRouteInventory.dastRunId, params.dastRunId));
		if (params.entries.length === 0) return [];
		const now = new Date();
		return await this.db
			.insert(dastRouteInventory)
			.values(
				params.entries.map((entry) => ({
					dastRunId: params.dastRunId,
					projectId: params.projectId,
					scanRunId: params.scanRunId,
					method: entry.method,
					path: entry.path,
					queryKeys: entry.queryKeys,
					queryShapeHash: entry.queryShapeHash,
					sources: entry.sources,
					depth: entry.depth,
					required: entry.required,
					authMode: entry.authMode,
					state: entry.state,
					statusCode: entry.statusCode,
					limitationCode: entry.limitationCode,
					metadata: {},
					createdAt: now,
					updatedAt: now,
				})),
			)
			.returning();
	}

	async listRouteInventory(dastRunId: string) {
		return await this.db.query.dastRouteInventory.findMany({
			where: eq(dastRouteInventory.dastRunId, dastRunId),
			orderBy: (entries, { asc }) => [
				asc(entries.depth),
				asc(entries.path),
				asc(entries.method),
			],
		});
	}

	async createArtifact(params: {
		dastRunId: string;
		projectId: string;
		scanRunId: string;
		kind: DastArtifactKind;
		format: string;
		path: string;
		sha256: string;
		sizeBytes: number;
		metadata?: Record<string, unknown>;
	}) {
		const [created] = await this.db
			.insert(dastArtifacts)
			.values({
				...params,
				metadata: params.metadata ?? {},
				createdAt: new Date(),
			})
			.returning();
		return created;
	}

	async listArtifacts(dastRunId: string) {
		return await this.db.query.dastArtifacts.findMany({
			where: eq(dastArtifacts.dastRunId, dastRunId),
		});
	}

	async createEvidence(params: {
		dastRunId: string;
		projectId: string;
		scanRunId: string;
		findingId?: string | null;
		kind: DastEvidenceKind;
		title: string;
		artifactId?: string | null;
		location?: Record<string, unknown> | null;
		snippet?: string | null;
		metadata?: Record<string, unknown>;
	}) {
		const [created] = await this.db
			.insert(dastEvidence)
			.values({
				dastRunId: params.dastRunId,
				projectId: params.projectId,
				scanRunId: params.scanRunId,
				findingId: params.findingId ?? null,
				kind: params.kind,
				title: params.title,
				artifactId: params.artifactId ?? null,
				location: params.location ?? null,
				snippet: params.snippet ?? null,
				metadata: params.metadata ?? {},
				createdAt: new Date(),
			})
			.returning();
		return created;
	}

	async listEvidence(dastRunId: string) {
		return await this.db.query.dastEvidence.findMany({
			where: eq(dastEvidence.dastRunId, dastRunId),
		});
	}
}
