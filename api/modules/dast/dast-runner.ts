import type { AppDatabase } from "../../db";
import { projects } from "../../db/schema";
import { FindingRepository, ScanRepository } from "../scans/repositories";
import type { DastBrowserAdapter } from "./browser-runner";
import type { DastAuthContextRepository } from "./auth-context-repository";
import { DastArtifactStorage } from "./dast-artifact-storage";
import { normalizeDastResult } from "./dast-normalizer";
import { executeDastProfile } from "./dast-profile-executor";
import { DastRepository } from "./dast-repository";
import type { DastFetch } from "./http-runner";
import {
	assertDastProfileRunnable,
	getDastProfile,
	type DastProfileDefinition,
} from "./profiles";
import { validateDastTargetConfig } from "./target-validator";
import type {
	DastFailureKind,
	DastRawResult,
	DastTargetValidationResult,
	ValidatedDastTarget,
} from "./types";
import { eq } from "drizzle-orm";
import type { DastCliResult, RunDastOptions } from "./dast-runner-types";

export type { DastCliResult, RunDastOptions } from "./dast-runner-types";

export class DastRunner {
	private readonly dastRepo: DastRepository;
	private readonly scanRepo: ScanRepository;
	private readonly findingRepo: FindingRepository;

	constructor(
		private readonly db: AppDatabase,
		private readonly deps: {
			storage?: DastArtifactStorage;
			fetchImpl?: DastFetch;
			browserAdapter?: DastBrowserAdapter;
			authContextRepository?: DastAuthContextRepository;
		} = {},
	) {
		this.dastRepo = new DastRepository(db);
		this.scanRepo = new ScanRepository(db);
		this.findingRepo = new FindingRepository(db);
	}

	private async getProject(projectId: string) {
		return (
			(await this.db.query.projects.findFirst({
				where: eq(projects.id, projectId),
			})) ?? null
		);
	}

	private async prepare(params: RunDastOptions): Promise<
		| {
				ok: true;
				profile: DastProfileDefinition;
				target: NonNullable<
					Awaited<ReturnType<DastRepository["getTargetConfig"]>>
				>;
				profileConfig: NonNullable<
					Awaited<ReturnType<DastRepository["getProfileConfig"]>>
				> | null;
				validation: ValidatedDastTarget;
		  }
		| {
				ok: false;
				failureKind: DastFailureKind;
				message: string;
				validation?: DastTargetValidationResult;
		  }
	> {
		const project = await this.getProject(params.projectId);
		if (!project) {
			return {
				ok: false,
				failureKind: "dast_target_rejected",
				message: "Project not found.",
			};
		}
		const target = await this.dastRepo.getTargetConfig(params.targetConfigId);
		if (!target || target.projectId !== params.projectId) {
			return {
				ok: false,
				failureKind: "dast_target_rejected",
				message: "DAST target config not found.",
			};
		}
		const profileConfig = params.profileConfigId
			? await this.dastRepo.getProfileConfig(params.profileConfigId)
			: params.useStoredProfileConfig === false
				? null
				: await this.dastRepo.getProfileConfigByProfileId(
						params.projectId,
						params.profileId,
					);
		if (profileConfig && profileConfig.projectId !== params.projectId) {
			return {
				ok: false,
				failureKind: "dast_target_rejected",
				message: "DAST profile config does not belong to the project.",
			};
		}
		if (profileConfig && profileConfig.targetConfigId !== target.id) {
			return {
				ok: false,
				failureKind: "dast_target_rejected",
				message: "DAST profile config target does not match requested target.",
			};
		}
		const profile = getDastProfile(params.profileId);
		if (!profile) {
			return {
				ok: false,
				failureKind: "dast_target_rejected",
				message: `DAST profile not found: ${params.profileId}`,
			};
		}
		try {
			assertDastProfileRunnable({
				profileId: profile.id,
				profileEnabled: profileConfig?.enabled ?? true,
				routePaths: profileConfig?.routePathsJson ?? [],
				formSelectors: profileConfig?.formSelectorsJson ?? [],
				authContextId: params.authContextId,
			});
		} catch (error) {
			return {
				ok: false,
				failureKind: "dast_target_rejected",
				message:
					error instanceof Error ? error.message : "DAST profile disabled.",
			};
		}

		const validation = await validateDastTargetConfig(target, {
			runner: params.runner,
		});
		if (!validation.ok) {
			return {
				ok: false,
				failureKind: "dast_target_rejected",
				message: validation.message,
				validation,
			};
		}
		return { ok: true, profile, target, profileConfig, validation };
	}

	async dryRun(params: RunDastOptions): Promise<DastCliResult> {
		const prepared = await this.prepare(params);
		if (!prepared.ok) {
			return {
				ok: false,
				dastRunId: null,
				scanRunId: params.scanRunId ?? null,
				status: "failed",
				outcome: "error",
				failureKind: prepared.failureKind,
				message: prepared.message,
				targetConfigId: params.targetConfigId,
				profileId: params.profileId,
			};
		}
		return {
			ok: true,
			dastRunId: null,
			scanRunId: params.scanRunId ?? null,
			status: "completed",
			outcome: "passed",
			targetConfigId: prepared.target.id,
			profileId: prepared.profile.id,
			artifactIds: [],
			findingIds: [],
			evidenceIds: [],
			summary: "DAST dry run validated target and profile without execution.",
			plan: {
				targetOrigin: prepared.validation.normalizedOrigin,
				runnerOrigin: prepared.validation.runnerOrigin,
				allowedPaths: prepared.validation.allowedPaths,
				excludedPaths: prepared.validation.excludedPaths,
				maxRequests: params.maxRequests ?? prepared.validation.maxRequests,
				timeoutSec: params.timeoutSec ?? prepared.validation.timeoutSec,
				profileKind: prepared.profile.kind,
			},
		};
	}

	private async saveRawArtifacts(params: {
		dastRunId: string;
		projectId: string;
		scanRunId: string;
		result: DastRawResult;
	}): Promise<{ rawArtifactId: string | null; artifactIds: string[] }> {
		const storage = this.deps.storage ?? new DastArtifactStorage();
		const artifactIds: string[] = [];
		const rawSaved = await storage.saveJsonArtifact(
			params.dastRunId,
			"raw",
			params.result,
			"raw-result.json",
		);
		const raw = await this.dastRepo.createArtifact({
			dastRunId: params.dastRunId,
			projectId: params.projectId,
			scanRunId: params.scanRunId,
			kind: "raw_result",
			format: "json",
			path: rawSaved.path,
			sha256: rawSaved.sha256,
			sizeBytes: rawSaved.sizeBytes,
		});
		artifactIds.push(raw.id);

		const summarySaved = await storage.saveTextArtifact(
			params.dastRunId,
			"summary",
			`${params.result.kind} DAST result with ${
				params.result.kind === "http"
					? params.result.responses.length
					: params.result.routes.length
			} observation(s).`,
			"summary.txt",
		);
		const summary = await this.dastRepo.createArtifact({
			dastRunId: params.dastRunId,
			projectId: params.projectId,
			scanRunId: params.scanRunId,
			kind: "summary",
			format: "text",
			path: summarySaved.path,
			sha256: summarySaved.sha256,
			sizeBytes: summarySaved.sizeBytes,
		});
		artifactIds.push(summary.id);

		if (params.result.kind === "browser") {
			for (const route of params.result.routes) {
				if (!route.screenshot) continue;
				const saved = await storage.saveBinaryArtifact(
					params.dastRunId,
					"screenshots",
					route.screenshot.bytes,
					route.screenshot.filename,
				);
				const artifact = await this.dastRepo.createArtifact({
					dastRunId: params.dastRunId,
					projectId: params.projectId,
					scanRunId: params.scanRunId,
					kind: "screenshot",
					format: "png",
					path: saved.path,
					sha256: saved.sha256,
					sizeBytes: saved.sizeBytes,
					metadata: { path: route.path, llmInputDefault: false },
				});
				artifactIds.push(artifact.id);
			}
		}

		return { rawArtifactId: raw.id, artifactIds };
	}

	async run(params: RunDastOptions): Promise<DastCliResult> {
		const manageScanRunStatus = params.manageScanRunStatus !== false;
		const prepared = await this.prepare(params);
		if (!prepared.ok) {
			return {
				ok: false,
				dastRunId: null,
				scanRunId: params.scanRunId ?? null,
				status: "failed",
				outcome: "error",
				failureKind: prepared.failureKind,
				message: prepared.message,
				targetConfigId: params.targetConfigId,
				profileId: params.profileId,
			};
		}

		const scanRun = params.scanRunId
			? await this.scanRepo.findById(params.scanRunId)
			: await this.scanRepo.createScanRun({
					projectId: params.projectId,
					profile: `dast:${prepared.profile.id}`,
					status: "running",
					createdByUserId: params.createdByUserId ?? null,
					metadata: {
						dastProfileId: prepared.profile.id,
						automaticDiagnosticRequested: true,
					},
				});
		if (!scanRun || scanRun.projectId !== params.projectId) {
			return {
				ok: false,
				dastRunId: null,
				scanRunId: params.scanRunId ?? null,
				status: "failed",
				outcome: "error",
				failureKind: "dast_target_rejected",
				message: "Scan run not found or not owned by project.",
				targetConfigId: params.targetConfigId,
				profileId: params.profileId,
			};
		}

		const dastRun = await this.dastRepo.createRun({
			projectId: params.projectId,
			scanRunId: scanRun.id,
			targetConfigId: prepared.target.id,
			profileConfigId: prepared.profileConfig?.id ?? null,
			profileId: prepared.profile.id,
			dastKind: prepared.profile.kind,
			targetOrigin: prepared.validation.normalizedOrigin,
			runnerOrigin: prepared.validation.runnerOrigin,
			status: "running",
			metadata: {
				validation: {
					resolvedAddresses: prepared.validation.resolvedAddresses,
					warnings: prepared.validation.warnings,
				},
				runner: params.runner ?? "host",
				dockerImage: params.dockerImage,
			},
			createdByUserId: params.createdByUserId ?? null,
		});

		try {
			const authMaterial = params.authContextId
				? await this.requireAuthContext(params)
				: undefined;
			const result = await executeDastProfile({
				profile: prepared.profile,
				target: prepared.validation,
				profileConfig: prepared.profileConfig,
				timeoutSec: params.timeoutSec,
				maxRequests: params.maxRequests,
				runner: params.runner,
				fetchImpl: this.deps.fetchImpl,
				browserAdapter: this.deps.browserAdapter,
				authMaterial,
			});

			const { rawArtifactId, artifactIds } = await this.saveRawArtifacts({
				dastRunId: dastRun.id,
				projectId: params.projectId,
				scanRunId: scanRun.id,
				result,
			});
			const normalized = normalizeDastResult({
				projectId: params.projectId,
				target: prepared.validation,
				profile: prepared.profile,
				result,
				rawArtifactId,
			});

			const findingIds: string[] = [];
			const findingIdsByFingerprint = new Map<string, string>();
			for (const finding of normalized.findings) {
				const created = await this.findingRepo.createFinding({
					scanRunId: scanRun.id,
					projectId: params.projectId,
					sourceTool: finding.sourceTool,
					ruleId: finding.ruleId,
					title: finding.title,
					description: finding.description,
					severity: finding.severity,
					confidence: finding.confidence,
					status: "open",
					primaryLocation: finding.primaryLocation,
					fingerprint: finding.fingerprint,
					metadata: finding.metadata,
				});
				findingIds.push(created.id);
				findingIdsByFingerprint.set(finding.fingerprint, created.id);
				for (const evidence of finding.evidence) {
					await this.findingRepo.createEvidence({
						findingId: created.id,
						kind: evidence.kind,
						title: evidence.title,
						artifactId: evidence.artifactId,
						location: evidence.location,
						snippet: evidence.snippet,
						metadata: evidence.metadata,
					});
				}
			}

			const evidenceIds: string[] = [];
			for (const evidence of normalized.evidence) {
				const created = await this.dastRepo.createEvidence({
					dastRunId: dastRun.id,
					projectId: params.projectId,
					scanRunId: scanRun.id,
					findingId: evidence.findingFingerprint
						? (findingIdsByFingerprint.get(evidence.findingFingerprint) ?? null)
						: null,
					kind: evidence.kind,
					title: evidence.title,
					artifactId: evidence.artifactId,
					location: evidence.location,
					snippet: evidence.snippet,
					metadata: evidence.metadata,
				});
				evidenceIds.push(created.id);
			}

			await this.dastRepo.updateRunStatus(dastRun.id, "completed", {
				outcome: normalized.outcome,
				summary: normalized.summary,
			});
			if (manageScanRunStatus) {
				await this.scanRepo.updateScanRunStatus(scanRun.id, "completed", {
					summary: normalized.summary,
					metadata: {
						dastRunId: dastRun.id,
						dastOutcome: normalized.outcome,
					},
				});
			}
			return {
				ok: true,
				dastRunId: dastRun.id,
				scanRunId: scanRun.id,
				status: "completed",
				outcome: normalized.outcome,
				targetConfigId: prepared.target.id,
				profileId: prepared.profile.id,
				artifactIds,
				findingIds,
				evidenceIds,
				summary: normalized.summary,
			};
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "DAST runner failed.";
			await this.dastRepo.updateRunStatus(dastRun.id, "failed", {
				outcome: "error",
				errorMessage: message,
				summary: "DAST run failed.",
			});
			if (manageScanRunStatus) {
				await this.scanRepo.updateScanRunStatus(scanRun.id, "failed", {
					summary: message,
					metadata: { dastRunId: dastRun.id, dastOutcome: "error" },
				});
			}
			return {
				ok: false,
				dastRunId: dastRun.id,
				scanRunId: scanRun.id,
				status: "failed",
				outcome: "error",
				failureKind: message.includes("browser_unavailable")
					? "browser_unavailable"
					: "unknown_error",
				message,
				targetConfigId: prepared.target.id,
				profileId: prepared.profile.id,
			};
		}
	}

	private async requireAuthContext(params: RunDastOptions) {
		if (!this.deps.authContextRepository) {
			throw new Error("dast_auth_context_repository_unavailable");
		}
		if (!params.identityRole) throw new Error("dast_identity_role_required");
		return await this.deps.authContextRepository.decryptForUse({
			id: params.authContextId as string,
			projectId: params.projectId,
			targetConfigId: params.targetConfigId,
			identityRole: params.identityRole,
			actorUserId: params.createdByUserId ?? undefined,
		});
	}
}
