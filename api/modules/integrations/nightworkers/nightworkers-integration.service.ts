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
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import { analyzeProjectCapabilities } from "../../project-capabilities/plugin-detector";
import { buildDiffScanPlan } from "../../scans/diff-scan-plan";
import { resolveFullScanTarget } from "../../scans/full-scan-target";
import { resolveGitDiff } from "../../scans/git-diff-resolver";
import { resolveNightworkersProject } from "./nightworkers-integration-project-resolver";
import type { ServiceDependencies } from "./nightworkers-integration-support";
import { NightworkersResultOperations } from "./nightworkers-result-operations";
import { NightworkersScanOperations } from "./nightworkers-scan-operations";
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
	"dependency-manifest",
	"artifact",
];
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

export class NightworkersIntegrationService {
	private readonly launchPromises = new Map<string, Promise<void>>();

	private readonly scanOperations: NightworkersScanOperations;
	private readonly resultOperations: NightworkersResultOperations;

	constructor(private readonly deps: ServiceDependencies) {
		this.scanOperations = new NightworkersScanOperations(
			deps,
			(params) => this.buildPreview(params),
			this.launchPromises,
		);
		this.resultOperations = new NightworkersResultOperations(
			deps,
			this.scanOperations,
		);
	}

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
		const technologyAnalysis = await analyzeProjectCapabilities(
			params.projectPath,
		);
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: params.projectPath,
				target: { kind: "working_tree", includeUntracked: true },
				scope: params.profile.scope,
			}),
			tools: params.profile.tools,
			detectedPluginIds: technologyAnalysis.detections
				.filter((detection) => detection.detected)
				.map((detection) => detection.pluginId),
			projectInventoryPaths: technologyAnalysis.context.inventory.map(
				(entry) => entry.path,
			),
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
		return this.scanOperations.startScan(params);
	}

	async scanDetail(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	): Promise<IntegrationScanRunDetail> {
		return this.resultOperations.scanDetail(client, scanRunId);
	}

	async events(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		afterSeq: number,
		limit: number,
	): Promise<IntegrationScanEventPage> {
		return this.resultOperations.events(client, scanRunId, afterSeq, limit);
	}

	async cancel(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		requestId = "unknown",
	): Promise<IntegrationScanRunDetail> {
		return this.resultOperations.cancel(client, scanRunId, requestId);
	}

	async findings(params: {
		client: AuthenticatedIntegrationClient;
		scanRunId: string;
		cursor?: string;
		limit: number;
		severity?: IntegrationSeverity;
		tool?: string;
	}): Promise<IntegrationFindingPage> {
		return this.resultOperations.findings(params);
	}

	async listReports(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
	): Promise<{ items: IntegrationReportDetail[] }> {
		return this.resultOperations.listReports(client, scanRunId);
	}

	async startReport(params: {
		client: AuthenticatedIntegrationClient;
		scanRunId: string;
		idempotencyKey: string;
		requestId?: string;
	}): Promise<{ report: IntegrationReportDetail; replayed: boolean }> {
		return this.resultOperations.startReport(params);
	}

	async reportDetail(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		reportId: string,
	): Promise<IntegrationReportDetail> {
		return this.resultOperations.reportDetail(client, scanRunId, reportId);
	}

	async reportContent(
		client: AuthenticatedIntegrationClient,
		scanRunId: string,
		reportId: string,
	): Promise<{ content: string; title: string }> {
		return this.resultOperations.reportContent(client, scanRunId, reportId);
	}
}
