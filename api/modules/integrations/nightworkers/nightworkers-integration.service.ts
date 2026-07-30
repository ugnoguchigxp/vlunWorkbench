import { createHash } from "node:crypto";
import type {
	IntegrationCapabilities,
	IntegrationFindingPage,
	IntegrationPreview,
	IntegrationPreviewRequest,
	IntegrationReportDetail,
	IntegrationScanEventPage,
	IntegrationScanRunDetail,
	IntegrationSeverity,
	IntegrationStartScanRequest,
	IntegrationStartScanResponse,
} from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type { AppEnv } from "../../../app/env";
import type { AppDatabase } from "../../../db";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import type { ScanReportRunner } from "../../reports/scan-report-runner";
import type { ArtifactStorage } from "../../scans/artifact-storage";
import { buildDiffScanPlan, canonicalJson } from "../../scans/diff-scan-plan";
import { resolveFullScanTarget } from "../../scans/full-scan-target";
import { resolveGitDiff } from "../../scans/git-diff-resolver";
import type { ScanReportRepository } from "../../scans/report-repository";
import type {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../../scans/repositories";
import {
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../../scans/scan-execution-policy";
import type { ScanProcessSupervisor } from "../../scans/scan-process-supervisor";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import {
	IntegrationIdempotencyConflictError,
	IntegrationScanCapacityError,
	type NightworkersIntegrationRepository,
} from "./nightworkers-integration.repository";
import {
	decodeFindingCursor,
	encodeFindingCursor,
} from "./nightworkers-integration-cursor";
import { resolveNightworkersProject } from "./nightworkers-integration-project-resolver";
import {
	projectIntegrationFinding,
	projectIntegrationReport,
	projectIntegrationScanEvent,
	projectIntegrationScanRun,
} from "./nightworkers-integration-projection";
import { readNightworkersReportContent } from "./nightworkers-report-content";
import {
	listNightworkersPresets,
	listNightworkersSelectableProfiles,
	profileToolSteps,
	resolveNightworkersProfile,
} from "./nightworkers-scan-preset-registry";

const INTEGRATION_PROVIDER_VERSION = "1.0.0";
const DEFAULT_ALLOWED_PROFILES = [
	"source-baseline",
	"diff-source-baseline",
	"diff-basic-security",
	"basic-security",
	"detailed-security",
];
const TERMINAL_SCAN_STATUSES = new Set(["completed", "failed", "cancelled"]);

type ResolvedTarget = {
	kind: "working_tree" | "full";
	digest: string;
	sourceRevision: string | null;
	fileCount: number | null;
	toolAvailability?: Map<
		string,
		{ availability: "available" | "unavailable"; reason?: string }
	>;
	warnings: string[];
};

type ServiceDependencies = {
	db: AppDatabase;
	env: AppEnv;
	projectRepository: ProjectRepository;
	scanRepository: ScanRepository;
	findingRepository: FindingRepository;
	reportRepository: ScanReportRepository;
	artifactRepository: ArtifactRepository;
	artifactStorage: ArtifactStorage;
	reportRunner: Pick<ScanReportRunner, "enqueue">;
	integrationRepository: NightworkersIntegrationRepository;
	scanSupervisor: ScanProcessSupervisor;
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function executionStatus(value: string): IntegrationScanRunDetail["status"] {
	if (
		value === "queued" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	) {
		return value;
	}
	return "failed";
}

export class NightworkersIntegrationService {
	private readonly launchPromises = new Map<string, Promise<void>>();

	constructor(private readonly deps: ServiceDependencies) {}

	private allowedProfiles(): string[] {
		return (
			this.deps.env.nightworkersIntegrationAllowedProfiles ??
			DEFAULT_ALLOWED_PROFILES
		);
	}

	private async resolveProject(
		client: AuthenticatedIntegrationClient,
		projectPath: string,
	) {
		return await resolveNightworkersProject({
			projectPath,
			client,
			projectRepository: this.deps.projectRepository,
			globalAllowedRoots: this.deps.env.projectAllowedRoots ?? [],
			autoCreateProjects:
				this.deps.env.nightworkersIntegrationAutoCreateProjects ?? false,
		});
	}

	async capabilities(
		client: AuthenticatedIntegrationClient,
		projectPath: string,
	): Promise<IntegrationCapabilities> {
		const resolved = await this.resolveProject(client, projectPath);
		return {
			provider: {
				id: "vulnworkbench",
				version: INTEGRATION_PROVIDER_VERSION,
			},
			project: {
				ref: resolved.project.id,
				displayName: resolved.project.name,
			},
			presets: listNightworkersPresets(this.allowedProfiles()),
			selectableProfiles: listNightworkersSelectableProfiles(
				this.allowedProfiles(),
			),
			limits: {
				maxConcurrentScansForClient:
					this.deps.env.nightworkersIntegrationMaxConcurrentScans ?? 2,
				maxFindingPageSize:
					this.deps.env.nightworkersIntegrationMaxFindingPageSize ?? 100,
				maxEventPageSize:
					this.deps.env.nightworkersIntegrationMaxEventPageSize ?? 200,
				maxReportBytes:
					this.deps.env.nightworkersIntegrationMaxReportBytes ??
					5 * 1024 * 1024,
			},
		};
	}

	private async resolveTarget(params: {
		projectPath: string;
		profile: ReturnType<typeof resolveNightworkersProfile>;
		targetKind: "working_tree" | "full";
	}): Promise<ResolvedTarget> {
		if (params.targetKind === "full") {
			const target = await resolveFullScanTarget(
				params.projectPath,
				params.profile.scope,
			);
			return {
				kind: "full",
				digest: target.digest,
				sourceRevision: target.sourceRevision,
				fileCount: null,
				warnings:
					target.changedFileCount > 0
						? ["未コミットの変更を含む現在のsnapshotを検査します。"]
						: [],
			};
		}
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: params.projectPath,
				target: { kind: "working_tree", includeUntracked: true },
				scope: params.profile.scope,
			}),
			tools: params.profile.tools,
		});
		const toolAvailability = new Map<
			string,
			{ availability: "available" | "unavailable"; reason?: string }
		>();
		for (const tool of plan.tools) {
			toolAvailability.set(tool.toolId, {
				availability:
					tool.applicability === "applicable" ? "available" : "unavailable",
				...(tool.reasonCode ? { reason: tool.reasonCode } : {}),
			});
		}
		const warnings: string[] = [];
		if (
			plan.manifest.coverage.unsupported > 0 ||
			plan.manifest.coverage.tooLarge > 0
		) {
			warnings.push("検査対象に未対応またはsize上限超過のファイルがあります。");
		}
		return {
			kind: "working_tree",
			digest: plan.target.targetDigest,
			sourceRevision: plan.target.baseSha,
			fileCount: plan.target.changedFileCount,
			toolAvailability,
			warnings,
		};
	}

	private async buildPreview(params: {
		client: AuthenticatedIntegrationClient;
		request: IntegrationPreviewRequest;
		persist: boolean;
	}): Promise<{
		preview: IntegrationPreview;
		projectId: string;
		projectPath: string;
	}> {
		const resolvedProject = await this.resolveProject(
			params.client,
			params.request.projectPath,
		);
		const profile = resolveNightworkersProfile({
			selection: params.request.selection,
			targetKind: params.request.target.kind,
			allowedProfileRefs: this.allowedProfiles(),
		});
		const target = await this.resolveTarget({
			projectPath: resolvedProject.canonicalPath,
			profile,
			targetKind: params.request.target.kind,
		});
		const warnings = [...target.warnings];
		const steps = profileToolSteps(profile).map((step) => {
			const resolvedAvailability = target.toolAvailability?.get(step.id);
			return resolvedAvailability
				? {
						...step,
						availability: resolvedAvailability.availability,
						...(resolvedAvailability.reason
							? { reason: resolvedAvailability.reason }
							: {}),
					}
				: step;
		});
		const expiresAt = new Date(
			Date.now() +
				(this.deps.env.nightworkersIntegrationPreviewTtlSeconds ?? 300) * 1_000,
		);
		const stored = params.persist
			? await this.deps.integrationRepository.createPreview({
					integrationClientId: params.client.id,
					projectId: resolvedProject.project.id,
					selection: params.request.selection,
					targetKind: params.request.target.kind,
					resolvedProfileRef: profile.id,
					targetDigest: target.digest,
					sourceRevision: target.sourceRevision,
					fileCount: target.fileCount,
					warnings,
					expiresAt,
				})
			: null;
		return {
			preview: {
				previewRef: stored?.id ?? "revalidated",
				resolvedProfileRef: profile.id,
				target: {
					kind: target.kind,
					digest: target.digest,
					sourceRevision: target.sourceRevision,
					fileCount: target.fileCount,
				},
				estimatedDurationSeconds: {
					min: Math.max(1, Math.floor(profile.defaultTimeoutSec / 6)),
					max: profile.defaultTimeoutSec,
				},
				toolSteps: steps,
				warnings,
				expiresAt: expiresAt.toISOString(),
			},
			projectId: resolvedProject.project.id,
			projectPath: resolvedProject.canonicalPath,
		};
	}

	async preview(
		client: AuthenticatedIntegrationClient,
		request: IntegrationPreviewRequest,
	): Promise<IntegrationPreview> {
		return (await this.buildPreview({ client, request, persist: true }))
			.preview;
	}

	async startScan(params: {
		client: AuthenticatedIntegrationClient;
		request: IntegrationStartScanRequest;
		idempotencyKey: string;
		requestId?: string;
	}): Promise<IntegrationStartScanResponse> {
		const requestHash = sha256(
			canonicalJson({
				projectPath: params.request.projectPath.trim(),
				selection: params.request.selection,
				target: params.request.target,
				previewRef: params.request.previewRef,
				targetDigest: params.request.expectedTargetDigest,
			}),
		);
		const existing = await this.deps.integrationRepository.findIdempotency({
			integrationClientId: params.client.id,
			operation: "scan_start",
			idempotencyKey: params.idempotencyKey,
		});
		if (existing) {
			if (existing.requestHash !== requestHash) {
				throw new NightworkersIntegrationError(
					"idempotency_conflict",
					"Idempotency key was already used with a different request.",
				);
			}
			const { binding, scan } = await this.assertScanBinding(
				params.client,
				existing.resourceId,
			);
			const metadata = asRecord(scan.metadata);
			const target = asRecord(metadata.target);
			const targetKind =
				target.kind === "working_tree" ? "working_tree" : "full";
			await this.deps.integrationRepository.recordAudit({
				integrationClientId: params.client.id,
				ownerUserId: params.client.ownerUserId,
				scope: "nightworkers:security-scan:write",
				operation: "scan_start",
				requestId: params.requestId ?? "unknown",
				projectRef: binding.projectId,
				pathHash: sha256(params.request.projectPath.trim()),
				idempotencyKeyHash: sha256(params.idempotencyKey),
				resourceRef: scan.id,
				outcome: "replayed",
			});
			return {
				scanRunRef: scan.id,
				status: executionStatus(scan.status),
				resolvedProfileRef: scan.profile,
				target: {
					kind: targetKind,
					digest:
						typeof target.digest === "string"
							? target.digest
							: params.request.expectedTargetDigest,
					sourceRevision:
						typeof target.sourceRevision === "string"
							? target.sourceRevision
							: null,
				},
				createdAt: scan.createdAt.toISOString(),
				replayed: true,
			};
		}
		const storedPreview = await this.deps.integrationRepository.findPreview({
			id: params.request.previewRef,
			integrationClientId: params.client.id,
		});
		if (!storedPreview || storedPreview.expiresAt.getTime() <= Date.now()) {
			throw new NightworkersIntegrationError(
				"preview_expired",
				"The scan preview is missing or expired.",
				true,
			);
		}
		const current = await this.buildPreview({
			client: params.client,
			request: {
				projectPath: params.request.projectPath,
				selection: params.request.selection,
				target: params.request.target,
			},
			persist: false,
		});
		const selectionHash = sha256(canonicalJson(params.request.selection));
		const storedSelectionHash = sha256(canonicalJson(storedPreview.selection));
		if (
			storedPreview.projectId !== current.projectId ||
			storedPreview.targetKind !== params.request.target.kind ||
			storedPreview.resolvedProfileRef !== current.preview.resolvedProfileRef ||
			selectionHash !== storedSelectionHash
		) {
			throw new NightworkersIntegrationError(
				"preview_expired",
				"The scan preview does not match this request.",
				true,
			);
		}
		if (
			storedPreview.targetDigest !== params.request.expectedTargetDigest ||
			current.preview.target.digest !== params.request.expectedTargetDigest
		) {
			throw new NightworkersIntegrationError(
				"target_digest_mismatch",
				"The project target changed after preview.",
				true,
			);
		}

		const active = await this.deps.integrationRepository.countActiveScans(
			params.client.id,
		);
		if (
			active >= (this.deps.env.nightworkersIntegrationMaxConcurrentScans ?? 2)
		) {
			throw new NightworkersIntegrationError(
				"scan_capacity_exceeded",
				"Integration scan concurrency limit exceeded.",
				true,
			);
		}
		const policy = resolveScanExecutionPolicy({
			env: this.deps.env,
			surface: "web",
		});
		let created: Awaited<
			ReturnType<NightworkersIntegrationRepository["createIdempotentScan"]>
		>;
		try {
			created = await this.deps.integrationRepository.createIdempotentScan({
				integrationClientId: params.client.id,
				ownerUserId: params.client.ownerUserId,
				projectId: current.projectId,
				profileRef: current.preview.resolvedProfileRef,
				requestHash,
				idempotencyKey: params.idempotencyKey,
				idempotencyExpiresAt: new Date(
					Date.now() +
						(this.deps.env.nightworkersIntegrationIdempotencyTtlHours ?? 168) *
							60 *
							60 *
							1_000,
				),
				metadata: {
					launchSource: "web",
					provenance: {
						kind: "nightworkers_integration",
						integrationClientId: params.client.id,
					},
					presetId:
						params.request.selection.mode === "preset"
							? params.request.selection.presetId
							: null,
					selection: params.request.selection,
					requestedTarget: params.request.target,
					expectedTargetDigest: params.request.expectedTargetDigest,
					target: current.preview.target,
					executionPolicy: scanExecutionPolicyMetadata(policy),
				},
				eventMessage: `Scan profile ${current.preview.resolvedProfileRef} queued.`,
				maxConcurrentScans:
					this.deps.env.nightworkersIntegrationMaxConcurrentScans ?? 2,
			});
		} catch (error) {
			if (error instanceof IntegrationIdempotencyConflictError) {
				throw new NightworkersIntegrationError(
					"idempotency_conflict",
					error.message,
				);
			}
			if (error instanceof IntegrationScanCapacityError) {
				throw new NightworkersIntegrationError(
					"scan_capacity_exceeded",
					error.message,
					true,
				);
			}
			throw error;
		}

		if (!created.replayed) {
			await this.ensureScanLaunched({
				scanRunId: created.resourceId,
				projectId: current.projectId,
				profileRef: current.preview.resolvedProfileRef,
				targetKind: params.request.target.kind,
				targetDigest: params.request.expectedTargetDigest,
				policyRunner: policy.runner,
			});
		}
		const scan = await this.deps.scanRepository.findById(created.resourceId);
		if (!scan) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"Created scan run could not be loaded.",
			);
		}
		await this.deps.integrationRepository.recordAudit({
			integrationClientId: params.client.id,
			ownerUserId: params.client.ownerUserId,
			scope: "nightworkers:security-scan:write",
			operation: "scan_start",
			requestId: params.requestId ?? "unknown",
			projectRef: current.projectId,
			pathHash: sha256(current.projectPath),
			idempotencyKeyHash: sha256(params.idempotencyKey),
			resourceRef: scan.id,
			outcome: created.replayed ? "replayed" : "accepted",
		});
		return {
			scanRunRef: scan.id,
			status: executionStatus(scan.status),
			resolvedProfileRef: scan.profile,
			target: {
				kind: params.request.target.kind,
				digest: params.request.expectedTargetDigest,
				sourceRevision: current.preview.target.sourceRevision,
			},
			createdAt: scan.createdAt.toISOString(),
			replayed: created.replayed,
		};
	}

	private async ensureScanLaunched(params: {
		scanRunId: string;
		projectId: string;
		profileRef: string;
		targetKind: "working_tree" | "full";
		targetDigest: string;
		policyRunner: "host" | "docker";
	}): Promise<void> {
		const existing = this.launchPromises.get(params.scanRunId);
		if (existing) return await existing;
		const launch = (async () => {
			const scan = await this.deps.scanRepository.findById(params.scanRunId);
			if (scan?.status !== "queued") return;
			const args = [
				"bun",
				"run",
				"api/cli/scan-profile.ts",
				"--scan-run-id",
				params.scanRunId,
				"--execution-surface",
				"web",
				"--project-id",
				params.projectId,
				"--profile",
				params.profileRef,
				"--continue-on-tool-failure",
				"true",
				"--runner",
				params.policyRunner,
				"--final-report",
				"false",
				"--target",
				params.targetKind === "working_tree" ? "working-tree" : "full",
			];
			if (params.targetKind === "working_tree") {
				args.push(
					"--include-untracked",
					"true",
					"--expected-target-digest",
					params.targetDigest,
				);
			}
			await this.deps.scanSupervisor.launch(params.scanRunId, args);
		})();
		this.launchPromises.set(params.scanRunId, launch);
		try {
			await launch;
		} finally {
			this.launchPromises.delete(params.scanRunId);
		}
	}

	private async assertScanBinding(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	) {
		const binding = await this.deps.integrationRepository.findResourceBinding({
			integrationClientId: client.id,
			resourceType: "scan_run",
			resourceId: scanRunId,
		});
		if (!binding) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"Scan run was not found for this integration client.",
			);
		}
		const scan = await this.deps.scanRepository.findById(scanRunId);
		if (!scan) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"Scan run was not found.",
			);
		}
		return { binding, scan };
	}

	async scanDetail(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	): Promise<IntegrationScanRunDetail> {
		const { scan } = await this.assertScanBinding(client, scanRunId);
		return await projectIntegrationScanRun(this.deps.db, scan);
	}

	async events(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		afterSeq: number,
		limit: number,
	): Promise<IntegrationScanEventPage> {
		await this.assertScanBinding(client, scanRunId);
		const maxLimit =
			this.deps.env.nightworkersIntegrationMaxEventPageSize ?? 200;
		const boundedLimit = Math.max(1, Math.min(limit, maxLimit));
		const rows = await this.deps.integrationRepository.listEventsPage({
			scanRunId,
			afterSeq,
			limit: boundedLimit,
		});
		const hasMore = rows.length > boundedLimit;
		const page = rows.slice(0, boundedLimit);
		return {
			items: page.map(projectIntegrationScanEvent),
			nextAfterSeq: page.at(-1)?.seq ?? afterSeq,
			hasMore,
		};
	}

	async cancel(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		requestId = "unknown",
	): Promise<IntegrationScanRunDetail> {
		const { binding, scan } = await this.assertScanBinding(client, scanRunId);
		if (!TERMINAL_SCAN_STATUSES.has(scan.status)) {
			const cancelled = await this.deps.scanSupervisor.cancel(
				scanRunId,
				"nightworkers_requested",
			);
			if (!cancelled.cancelled && cancelled.reason !== "scan_not_active") {
				throw new NightworkersIntegrationError(
					"provider_temporarily_unavailable",
					"Scan process is not owned by this runtime.",
					true,
					{ reason: cancelled.reason ?? "unknown" },
				);
			}
		}
		const detail = await this.scanDetail(client, scanRunId);
		await this.deps.integrationRepository.recordAudit({
			integrationClientId: client.id,
			ownerUserId: client.ownerUserId,
			scope: "nightworkers:security-scan:write",
			operation: "scan_cancel",
			requestId,
			projectRef: binding.projectId,
			resourceRef: scan.id,
			outcome: detail.status === "cancelled" ? "cancelled" : "terminal_replay",
		});
		return detail;
	}

	async findings(params: {
		client: AuthenticatedIntegrationClient;
		scanRunId: string;
		cursor?: string;
		limit: number;
		severity?: IntegrationSeverity;
		tool?: string;
	}): Promise<IntegrationFindingPage> {
		const { binding } = await this.assertScanBinding(
			params.client,
			params.scanRunId,
		);
		const project = await this.deps.projectRepository.findById(
			binding.projectId,
		);
		if (!project) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"Bound project was not found.",
			);
		}
		const decoded = params.cursor
			? decodeFindingCursor(params.cursor, params.client.tokenHash)
			: null;
		if (
			params.cursor &&
			(!decoded ||
				decoded.scanRunId !== params.scanRunId ||
				decoded.severity !== (params.severity ?? null) ||
				decoded.tool !== (params.tool ?? null))
		) {
			throw new NightworkersIntegrationError(
				"invalid_request",
				"Finding cursor is invalid for this query.",
			);
		}
		const maxLimit =
			this.deps.env.nightworkersIntegrationMaxFindingPageSize ?? 100;
		const boundedLimit = Math.max(1, Math.min(params.limit, maxLimit));
		const rows = await this.deps.integrationRepository.listFindingRows({
			scanRunId: params.scanRunId,
			limit: boundedLimit,
			...(decoded
				? {
						after: {
							createdAt: new Date(decoded.createdAt),
							id: decoded.id,
						},
					}
				: {}),
			severity: params.severity,
			tool: params.tool,
		});
		const hasMore = rows.length > boundedLimit;
		const page = rows.slice(0, boundedLimit);
		const items = await Promise.all(
			page.map(async (finding) => {
				const evidence = await this.deps.findingRepository.listEvidence(
					finding.id,
				);
				return projectIntegrationFinding(
					finding,
					evidence,
					project.canonicalRepoPath ?? project.repoPath,
				);
			}),
		);
		const last = page.at(-1);
		return {
			items,
			nextCursor:
				hasMore && last
					? encodeFindingCursor(
							{
								version: 1,
								scanRunId: params.scanRunId,
								createdAt: last.createdAt.toISOString(),
								id: last.id,
								severity: params.severity ?? null,
								tool: params.tool ?? null,
							},
							params.client.tokenHash,
						)
					: null,
		};
	}

	async listReports(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	): Promise<{ items: IntegrationReportDetail[] }> {
		await this.assertScanBinding(client, scanRunId);
		const [rows, artifacts] = await Promise.all([
			this.deps.integrationRepository.listReportsForBoundScan({
				integrationClientId: client.id,
				scanRunId,
			}),
			this.deps.artifactRepository.listArtifacts(scanRunId),
		]);
		return {
			items: rows.map(({ report }) =>
				projectIntegrationReport(
					report,
					artifacts.find((artifact) => artifact.id === report.artifactId),
				),
			),
		};
	}

	async startReport(params: {
		client: AuthenticatedIntegrationClient;
		scanRunId: string;
		idempotencyKey: string;
		requestId?: string;
	}): Promise<{ report: IntegrationReportDetail; replayed: boolean }> {
		const { binding, scan } = await this.assertScanBinding(
			params.client,
			params.scanRunId,
		);
		if (scan.status !== "completed") {
			throw new NightworkersIntegrationError(
				"scan_not_reportable",
				"Only completed scans can start reports.",
			);
		}
		const requestHash = sha256(
			canonicalJson({
				scanRunId: scan.id,
				summaryMode: "deterministic_with_llm_summary",
			}),
		);
		let created: Awaited<
			ReturnType<NightworkersIntegrationRepository["createIdempotentReport"]>
		>;
		try {
			created = await this.deps.integrationRepository.createIdempotentReport({
				integrationClientId: params.client.id,
				ownerUserId: params.client.ownerUserId,
				projectId: binding.projectId,
				scanRunId: scan.id,
				requestHash,
				idempotencyKey: params.idempotencyKey,
				idempotencyExpiresAt: new Date(
					Date.now() +
						(this.deps.env.nightworkersIntegrationIdempotencyTtlHours ?? 168) *
							60 *
							60 *
							1_000,
				),
				title: "NightWorkers security scan report",
				options: {
					includeFalsePositives: true,
					includeDeferred: true,
					includeUndecided: true,
					summaryMode: "deterministic_with_llm_summary",
				},
			});
		} catch (error) {
			if (error instanceof IntegrationIdempotencyConflictError) {
				throw new NightworkersIntegrationError(
					"idempotency_conflict",
					error.message,
				);
			}
			throw error;
		}
		if (!created.replayed) {
			void this.deps.reportRunner.enqueue(created.resourceId);
		}
		await this.deps.integrationRepository.recordAudit({
			integrationClientId: params.client.id,
			ownerUserId: params.client.ownerUserId,
			scope: "nightworkers:security-report:write",
			operation: "report_start",
			requestId: params.requestId ?? "unknown",
			projectRef: binding.projectId,
			idempotencyKeyHash: sha256(params.idempotencyKey),
			resourceRef: created.resourceId,
			outcome: created.replayed ? "replayed" : "accepted",
		});
		return {
			report: await this.reportDetail(
				params.client,
				params.scanRunId,
				created.resourceId,
			),
			replayed: created.replayed,
		};
	}

	async reportDetail(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		reportId: string,
	): Promise<IntegrationReportDetail> {
		await this.assertScanBinding(client, scanRunId);
		const binding = await this.deps.integrationRepository.findResourceBinding({
			integrationClientId: client.id,
			resourceType: "scan_report",
			resourceId: reportId,
		});
		const report = binding
			? await this.deps.reportRepository.findById(reportId)
			: null;
		if (!report || report.scanRunId !== scanRunId) {
			throw new NightworkersIntegrationError(
				"report_not_found",
				"Report was not found for this integration client.",
			);
		}
		const artifacts =
			await this.deps.artifactRepository.listArtifacts(scanRunId);
		return projectIntegrationReport(
			report,
			artifacts.find((artifact) => artifact.id === report.artifactId),
		);
	}

	async reportContent(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		reportId: string,
	): Promise<{ content: string; title: string }> {
		await this.reportDetail(client, scanRunId, reportId);
		const report = await this.deps.reportRepository.findById(reportId);
		if (report?.status !== "completed" || !report.artifactId) {
			throw new NightworkersIntegrationError(
				"report_not_ready",
				"Report content is not ready.",
				true,
			);
		}
		const artifacts =
			await this.deps.artifactRepository.listArtifacts(scanRunId);
		const artifact = artifacts.find((candidate) => {
			const metadata = asRecord(candidate.metadata);
			return (
				candidate.id === report.artifactId &&
				candidate.kind === "report" &&
				candidate.format === "markdown" &&
				metadata.reportId === report.id
			);
		});
		if (!artifact) {
			throw new NightworkersIntegrationError(
				"report_not_found",
				"Report artifact was not found.",
			);
		}
		const maxBytes =
			this.deps.env.nightworkersIntegrationMaxReportBytes ?? 5 * 1024 * 1024;
		const content = await readNightworkersReportContent({
			artifact,
			storage: this.deps.artifactStorage,
			maxBytes,
		});
		return { content, title: report.title };
	}
}
