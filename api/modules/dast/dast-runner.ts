import type { AppDatabase } from "../../db";
import { EMPTY_DAST_COVERAGE_SUMMARY } from "../../../shared/schemas/dast-coverage.schema";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "../scans/repositories";
import type { ArtifactStorage } from "../scans/artifact-storage";
import type { DastBrowserAdapter } from "./browser-runner";
import type { DastAuthContextRepository } from "./auth-context-repository";
import type { DastArtifactStorage } from "./dast-artifact-storage";
import { normalizeDastResult } from "./dast-normalizer";
import { executeDastProfile } from "./dast-profile-executor";
import { DastRepository } from "./dast-repository";
import { saveDastRawArtifacts } from "./dast-run-artifacts";
import { emitDastAssessmentEvents } from "./dast-run-events";
import { prepareDastRun } from "./dast-run-preparation";
import type { DastFetch } from "./http-runner";
import { policyForDastProfile } from "./policy";
import type { DastCliResult, RunDastOptions } from "./dast-runner-types";

export type { DastCliResult, RunDastOptions } from "./dast-runner-types";

export class DastRunner {
	private readonly dastRepo: DastRepository;
	private readonly scanRepo: ScanRepository;
	private readonly findingRepo: FindingRepository;
	private readonly artifactRepo: ArtifactRepository;

	constructor(
		private readonly db: AppDatabase,
		private readonly deps: {
			storage?: DastArtifactStorage;
			scanStorage?: ArtifactStorage;
			fetchImpl?: DastFetch;
			browserAdapter?: DastBrowserAdapter;
			authContextRepository?: DastAuthContextRepository;
		} = {},
	) {
		this.dastRepo = new DastRepository(db);
		this.scanRepo = new ScanRepository(db);
		this.findingRepo = new FindingRepository(db);
		this.artifactRepo = new ArtifactRepository(db);
	}

	async dryRun(params: RunDastOptions): Promise<DastCliResult> {
		const prepared = await prepareDastRun({
			db: this.db,
			repository: this.dastRepo,
			options: params,
		});
		if (!prepared.ok) {
			return {
				ok: false,
				dastRunId: null,
				scanRunId: params.scanRunId ?? null,
				status: "failed",
				outcome: "error",
				verdict: "not_tested",
				coverageStatus: "gap",
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
			outcome: "inconclusive",
			verdict: "not_tested",
			coverageStatus: "gap",
			coverageSummary: EMPTY_DAST_COVERAGE_SUMMARY,
			limitationCodes: ["dry_run_no_requests"],
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

	async run(params: RunDastOptions): Promise<DastCliResult> {
		const manageScanRunStatus = params.manageScanRunStatus !== false;
		const prepared = await prepareDastRun({
			db: this.db,
			repository: this.dastRepo,
			options: params,
		});
		if (!prepared.ok) {
			return {
				ok: false,
				dastRunId: null,
				scanRunId: params.scanRunId ?? null,
				status: "failed",
				outcome: "error",
				verdict: "not_tested",
				coverageStatus: "gap",
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
				verdict: "not_tested",
				coverageStatus: "gap",
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
			...policyForDastProfile(prepared.profile),
			metadata: {
				validation: {
					resolvedAddresses: prepared.validation.resolvedAddresses,
					warnings: prepared.validation.warnings,
				},
				runner: params.runner ?? "host",
				dockerImage: params.dockerImage,
				auth: params.authContextId
					? {
							contextId: params.authContextId,
							identityRole: params.identityRole,
							mode: "authenticated",
						}
					: { mode: "anonymous" },
			},
			createdByUserId: params.createdByUserId ?? null,
		});
		await this.scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "dast.discovery.started",
			message: `${prepared.profile.id} route discovery started.`,
			data: {
				dastRunId: dastRun.id,
				profileId: prepared.profile.id,
				maxDepth: prepared.validation.maxDepth,
				maxRequests: params.maxRequests ?? prepared.validation.maxRequests,
			},
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
				checkOptions: params.checkOptions,
				runner: params.runner,
				fetchImpl: this.deps.fetchImpl,
				browserAdapter: this.deps.browserAdapter,
				authMaterial,
				projectRoot: prepared.projectRoot,
			});

			const { rawArtifactId, rawScanArtifactId, artifactIds } =
				await saveDastRawArtifacts({
					repository: this.dastRepo,
					artifactRepository: this.artifactRepo,
					storage: this.deps.storage,
					scanStorage: this.deps.scanStorage,
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
			await this.dastRepo.replaceRouteInventory({
				dastRunId: dastRun.id,
				projectId: params.projectId,
				scanRunId: scanRun.id,
				entries: result.routeInventory,
			});
			await emitDastAssessmentEvents({
				scanRepository: this.scanRepo,
				scanRunId: scanRun.id,
				dastRunId: dastRun.id,
				profileId: prepared.profile.id,
				requiresAuth: prepared.profile.requiresAuth,
				result,
				normalized,
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
						artifactId: evidence.artifactId ? rawScanArtifactId : null,
						location: evidence.location,
						snippet: evidence.snippet,
						metadata: {
							...evidence.metadata,
							dastArtifactId: evidence.artifactId,
						},
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
				verdict: normalized.verdict,
				coverageStatus: normalized.coverageStatus,
				coverageSummary: normalized.coverageSummary,
				limitationCodes: normalized.limitationCodes,
				summary: normalized.summary,
			});
			await this.scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: normalized.coverageStatus === "covered" ? "info" : "warn",
				eventType: "dast.completed",
				message: normalized.summary,
				data: {
					dastRunId: dastRun.id,
					profileId: prepared.profile.id,
					verdict: normalized.verdict,
					coverageStatus: normalized.coverageStatus,
					coverageSummary: normalized.coverageSummary,
					limitationCodes: normalized.limitationCodes,
				},
			});
			if (manageScanRunStatus) {
				await this.scanRepo.updateScanRunStatus(scanRun.id, "completed", {
					summary: normalized.summary,
					metadata: {
						dastRunId: dastRun.id,
						dastOutcome: normalized.outcome,
						dastVerdict: normalized.verdict,
						dastCoverageStatus: normalized.coverageStatus,
						dastCoverageSummary: normalized.coverageSummary,
						dastLimitationCodes: normalized.limitationCodes,
					},
				});
			}
			return {
				ok: true,
				dastRunId: dastRun.id,
				scanRunId: scanRun.id,
				status: "completed",
				outcome: normalized.outcome,
				verdict: normalized.verdict,
				coverageStatus: normalized.coverageStatus,
				coverageSummary: normalized.coverageSummary,
				limitationCodes: normalized.limitationCodes,
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
			if (
				prepared.profile.requiresAuth &&
				/(?:auth|login|session|credential)/i.test(message)
			) {
				await this.scanRepo.createScanEvent({
					scanRunId: scanRun.id,
					level: "error",
					eventType: "dast.auth.preflight_failed",
					message: "Authenticated DAST preflight failed.",
					data: {
						dastRunId: dastRun.id,
						profileId: prepared.profile.id,
					},
				});
			}
			await this.dastRepo.updateRunStatus(dastRun.id, "failed", {
				outcome: "error",
				verdict: "inconclusive",
				coverageStatus: "gap",
				coverageSummary: EMPTY_DAST_COVERAGE_SUMMARY,
				limitationCodes: ["runner_failed"],
				errorMessage: message,
				summary: "DAST run failed.",
			});
			if (manageScanRunStatus) {
				await this.scanRepo.updateScanRunStatus(scanRun.id, "failed", {
					summary: message,
					metadata: {
						dastRunId: dastRun.id,
						dastOutcome: "error",
						dastVerdict: "inconclusive",
						dastCoverageStatus: "gap",
						dastLimitationCodes: ["runner_failed"],
					},
				});
			}
			await this.scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "error",
				eventType: "dast.failed",
				message,
				data: {
					dastRunId: dastRun.id,
					profileId: prepared.profile.id,
					verdict: "inconclusive",
					coverageStatus: "gap",
					limitationCodes: ["runner_failed"],
				},
			});
			return {
				ok: false,
				dastRunId: dastRun.id,
				scanRunId: scanRun.id,
				status: "failed",
				outcome: "error",
				verdict: "inconclusive",
				coverageStatus: "gap",
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
