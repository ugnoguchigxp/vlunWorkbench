import type {
	CreateProviderWorkspaceTargetGrantRequest,
	ProviderWorkspaceTargetPreviewRequest,
	ProviderWorkspaceTargetStartRequest,
} from "../../../../shared/schemas/nightworkers-security-intelligence-binding.schema";
import {
	deriveProviderWorkspaceTargetGrant,
	providerWorkspaceTargetPreviewSchema,
	providerWorkspaceTargetStartResponseSchema,
} from "../../../../shared/schemas/nightworkers-security-intelligence-binding.schema";
import { canonicalStringifySecurityIntelligenceValue } from "../../../../shared/security-intelligence-assessment-contract";
import type { AppEnv } from "../../../app/env";
import {
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../../scans/scan-execution-policy";
import type {
	ProjectRepository,
	ScanRepository,
} from "../../scans/repositories";
import type { ScanProcessSupervisor } from "../../scans/scan-process-supervisor";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import { sha256 } from "./nightworkers-integration-support";
import {
	WorkspaceGrantAlreadyConsumedError,
	WorkspaceGrantCapacityError,
	WorkspaceGrantChangedError,
	WorkspaceGrantIdempotencyConflictError,
	type NightworkersWorkspaceTargetGrantRepository,
} from "./nightworkers-workspace-target-grant.repository";
import {
	asWorkspaceGrantRecord,
	isWorkspaceGrantScanStatus,
	workspaceGrantScanArgs,
} from "./nightworkers-workspace-target-grant-launch";
import {
	assertCapturedWorkspaceGrantState,
	assertWorkspaceGrantFresh,
	buildWorkspaceGrantPlan,
	requireActiveWorkspaceGrant,
	type WorkspaceGrantRow as GrantRow,
	type WorkspacePlan,
	type WorkspacePlanBuilder,
} from "./nightworkers-workspace-target-grant-plan";
import { captureWorkspaceTargetState } from "./nightworkers-workspace-target-state";

export class NightworkersWorkspaceTargetGrantService {
	private readonly captureState: typeof captureWorkspaceTargetState;
	private readonly planBuilder?: WorkspacePlanBuilder;

	constructor(
		private readonly deps: {
			env: Pick<
				AppEnv,
				| "nightworkersIntegrationAllowedProfiles"
				| "nightworkersIntegrationIdempotencyTtlHours"
				| "nightworkersIntegrationMaxConcurrentScans"
				| "nightworkersIntegrationPreviewTtlSeconds"
				| "nightworkersSecurityIntelligenceAllowedProjectIds"
				| "nightworkersSecurityIntelligenceWorkspaceGrantEnabled"
				| "nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds"
				| "nodeEnv"
				| "scanExecutionMode"
				| "allowHostScannerExecution"
				| "scanDockerImage"
				| "dockerMemory"
				| "dockerCpus"
				| "dockerPidsLimit"
				| "scannerStdoutLimitBytes"
				| "scannerStderrLimitBytes"
			>;
			projectRepository: Pick<ProjectRepository, "findById">;
			scanRepository: Pick<ScanRepository, "findById">;
			grantRepository: NightworkersWorkspaceTargetGrantRepository;
			scanSupervisor: Pick<ScanProcessSupervisor, "launch">;
			captureState?: typeof captureWorkspaceTargetState;
			planBuilder?: WorkspacePlanBuilder;
			now?: () => Date;
		},
	) {
		this.captureState = deps.captureState ?? captureWorkspaceTargetState;
		this.planBuilder = deps.planBuilder;
	}

	async createGrant(
		client: AuthenticatedIntegrationClient,
		request: CreateProviderWorkspaceTargetGrantRequest,
	) {
		this.assertEnabled();
		try {
			await this.deps.grantRepository.clearExpiredWorkspacePaths(this.now());
		} catch {
			// Privacy cleanup is retried on the next grant operation and does not
			// change the result of an already authorized scan.
		}
		const project = await this.deps.projectRepository.findById(
			request.providerProjectRef,
		);
		if (
			!project ||
			project.ownerUserId !== client.ownerUserId ||
			!this.deps.env.nightworkersSecurityIntelligenceAllowedProjectIds.includes(
				project.id,
			)
		) {
			throw new NightworkersIntegrationError(
				"project_not_found",
				"The registered provider project was not found.",
			);
		}
		const registered = await this.captureState({
			workspacePath: project.canonicalRepoPath ?? project.repoPath,
			allowedRoots: client.allowedRoots,
		});
		const workspace = await this.captureState({
			workspacePath: request.workspacePath,
			allowedRoots: client.allowedRoots,
		});
		if (
			registered.gitCommonDirDigest !== workspace.gitCommonDirDigest ||
			request.expectedGitCommonDirDigest !== workspace.gitCommonDirDigest
		) {
			throw new NightworkersIntegrationError(
				"project_path_denied",
				"The workspace does not belong to the registered Git repository.",
			);
		}
		if (request.expectedHeadSha !== workspace.headSha) {
			throw new NightworkersIntegrationError(
				"target_digest_mismatch",
				"The workspace HEAD does not match the requested revision.",
			);
		}
		const now = this.now();
		const expiresAt = new Date(
			now.getTime() +
				(this.deps.env
					.nightworkersSecurityIntelligenceWorkspaceGrantTtlSeconds ?? 300) *
					1_000,
		);
		const grant = deriveProviderWorkspaceTargetGrant({
			version: 1,
			providerProjectRef: project.id,
			workspaceSubjectRef: request.workspaceSubjectRef,
			expectedGitCommonDirDigest: workspace.gitCommonDirDigest,
			expectedHeadSha: workspace.headSha,
			providerWorkspaceStateDigest: workspace.workspaceStateDigest,
			expiresAt: expiresAt.toISOString(),
		});
		await this.deps.grantRepository.create({
			grantRef: grant.grantRef,
			grantDigest: grant.grantDigest,
			integrationClientId: client.id,
			ownerUserId: client.ownerUserId,
			projectId: project.id,
			workspaceSubjectRef: request.workspaceSubjectRef,
			canonicalWorkspacePath: workspace.canonicalWorkspacePath,
			expectedGitCommonDirDigest: workspace.gitCommonDirDigest,
			expectedHeadSha: workspace.headSha,
			providerWorkspaceStateDigest: workspace.workspaceStateDigest,
			expiresAt,
		});
		return grant;
	}

	async preview(
		client: AuthenticatedIntegrationClient,
		grantRef: string,
		request: ProviderWorkspaceTargetPreviewRequest,
	) {
		this.assertEnabled();
		const grant = await requireActiveWorkspaceGrant({
			repository: this.deps.grantRepository,
			client,
			grantRef,
			now: this.now(),
		});
		const plan = await this.buildPlan(client, grant, request.selection);
		assertCapturedWorkspaceGrantState(grant, plan.state);
		const previewExpiresAt = new Date(
			Math.min(
				grant.expiresAt.getTime(),
				this.now().getTime() +
					this.deps.env.nightworkersIntegrationPreviewTtlSeconds * 1_000,
			),
		);
		const previewRef = `siwp:v1:${sha256(
			canonicalStringifySecurityIntelligenceValue({
				grantRef,
				selection: request.selection,
				targetDigest: plan.target.targetDigest,
				workspaceStateDigest: plan.state.workspaceStateDigest,
				expiresAt: previewExpiresAt.toISOString(),
			}),
		)}`;
		const saved = await this.deps.grantRepository.savePreview({
			grantId: grant.id,
			expectedRevision: grant.revision,
			previewRef,
			selection: request.selection,
			targetDigest: plan.target.targetDigest,
			sourceRevision: plan.target.baseSha,
			workspaceStateDigest: plan.state.workspaceStateDigest,
			expiresAt: previewExpiresAt,
		});
		if (!saved) {
			throw new NightworkersIntegrationError(
				"preview_expired",
				"The workspace target grant changed before preview was saved.",
				true,
			);
		}
		return providerWorkspaceTargetPreviewSchema.parse({
			version: 1,
			grantRef,
			previewRef,
			resolvedProfileRef: plan.profileRef,
			target: {
				kind: "working_tree",
				digest: plan.target.targetDigest,
				canonicalDigest: `sha256:${plan.target.targetDigest}`,
				baseRevision: plan.target.baseSha,
				assessedRevision:
					plan.target.headSha ?? `working-tree/${plan.target.targetDigest}`,
				providerWorkspaceStateDigest: plan.state.workspaceStateDigest,
				fileCount: plan.fileCount,
			},
			expiresAt: previewExpiresAt.toISOString(),
		});
	}

	async start(
		client: AuthenticatedIntegrationClient,
		grantRef: string,
		request: ProviderWorkspaceTargetStartRequest,
		idempotencyKey: string,
	) {
		this.assertEnabled();
		const grant = await this.deps.grantRepository.findForClient({
			grantRef,
			integrationClientId: client.id,
		});
		if (!grant || grant.ownerUserId !== client.ownerUserId) {
			throw new NightworkersIntegrationError(
				"project_not_found",
				"The workspace target grant was not found.",
			);
		}
		const requestHash = sha256(
			canonicalStringifySecurityIntelligenceValue({
				grantRef,
				previewRef: request.previewRef,
				selection: request.selection,
				expectedTargetDigest: request.expectedTargetDigest,
			}),
		);
		if (grant.consumedAt) {
			if (
				grant.consumedRequestHash !== requestHash ||
				!grant.consumedScanRunId
			) {
				throw new NightworkersIntegrationError(
					"idempotency_conflict",
					"The workspace target grant was already consumed.",
				);
			}
			return await this.startResponse({
				grant,
				scanRunId: grant.consumedScanRunId,
				replayed: true,
			});
		}
		assertWorkspaceGrantFresh(grant, this.now());
		if (
			grant.previewRef !== request.previewRef ||
			!grant.previewExpiresAt ||
			grant.previewExpiresAt.getTime() <= this.now().getTime() ||
			grant.previewTargetDigest !== request.expectedTargetDigest ||
			canonicalStringifySecurityIntelligenceValue(grant.previewSelection) !==
				canonicalStringifySecurityIntelligenceValue(request.selection)
		) {
			throw new NightworkersIntegrationError(
				"preview_expired",
				"The workspace preview does not match this start request.",
				true,
			);
		}
		const plan = await this.buildPlan(client, grant, request.selection);
		assertCapturedWorkspaceGrantState(grant, plan.state);
		if (
			plan.state.workspaceStateDigest !== grant.previewWorkspaceStateDigest ||
			plan.target.targetDigest !== request.expectedTargetDigest
		) {
			throw new NightworkersIntegrationError(
				"target_digest_mismatch",
				"The workspace changed after preview.",
			);
		}
		const policy = resolveScanExecutionPolicy({
			env: this.deps.env,
			surface: "web",
		});
		let created: { resourceId: string; replayed: boolean };
		try {
			created = await this.deps.grantRepository.consumeAndCreateScan({
				grantId: grant.id,
				grantRef,
				expectedRevision: grant.revision,
				integrationClientId: client.id,
				ownerUserId: client.ownerUserId,
				projectId: grant.projectId,
				profileRef: plan.profileRef,
				requestHash,
				idempotencyKey,
				idempotencyExpiresAt: new Date(
					this.now().getTime() +
						this.deps.env.nightworkersIntegrationIdempotencyTtlHours *
							60 *
							60 *
							1_000,
				),
				metadata: {
					launchSource: "web",
					provenance: {
						kind: "nightworkers_security_intelligence_workspace_grant",
						integrationClientId: client.id,
						workspaceSubjectRef: grant.workspaceSubjectRef,
					},
					selection: request.selection,
					requestedTarget: {
						kind: "working_tree",
						includeUntracked: true,
					},
					expectedTargetDigest: request.expectedTargetDigest,
					target: plan.target,
					workspaceTargetGrantRef: grantRef,
					providerWorkspaceStateDigest: plan.state.workspaceStateDigest,
					executionPolicy: scanExecutionPolicyMetadata(policy),
				},
				eventMessage: `Scan profile ${plan.profileRef} queued.`,
				maxConcurrentScans:
					this.deps.env.nightworkersIntegrationMaxConcurrentScans,
			});
		} catch (error) {
			if (
				error instanceof WorkspaceGrantIdempotencyConflictError ||
				error instanceof WorkspaceGrantAlreadyConsumedError
			) {
				throw new NightworkersIntegrationError(
					"idempotency_conflict",
					"The workspace target grant conflicts with an existing request.",
				);
			}
			if (error instanceof WorkspaceGrantCapacityError) {
				throw new NightworkersIntegrationError(
					"scan_capacity_exceeded",
					"Integration scan concurrency limit exceeded.",
					true,
				);
			}
			if (error instanceof WorkspaceGrantChangedError) {
				throw new NightworkersIntegrationError(
					"preview_expired",
					"The workspace target grant changed before the scan was created.",
					true,
				);
			}
			throw error;
		}
		return await this.startResponse({
			grant: {
				...grant,
				previewTargetDigest: plan.target.targetDigest,
				previewSourceRevision: plan.target.baseSha,
				previewWorkspaceStateDigest: plan.state.workspaceStateDigest,
			},
			scanRunId: created.resourceId,
			replayed: created.replayed,
		});
	}

	private async startResponse(params: {
		grant: GrantRow;
		scanRunId: string;
		replayed: boolean;
	}) {
		const scan = await this.deps.scanRepository.findById(params.scanRunId);
		const metadata = asWorkspaceGrantRecord(scan?.metadata);
		const target = asWorkspaceGrantRecord(metadata.target);
		if (
			!scan ||
			scan.projectId !== params.grant.projectId ||
			scan.createdByUserId !== params.grant.ownerUserId ||
			!params.grant.previewTargetDigest ||
			!params.grant.previewSourceRevision ||
			!params.grant.previewWorkspaceStateDigest ||
			metadata.workspaceTargetGrantRef !== params.grant.grantRef ||
			metadata.expectedTargetDigest !== params.grant.previewTargetDigest ||
			target.kind !== "working_tree" ||
			target.targetDigest !== params.grant.previewTargetDigest ||
			!isWorkspaceGrantScanStatus(scan.status)
		) {
			throw new NightworkersIntegrationError(
				"scan_not_found",
				"The workspace scan could not be loaded.",
			);
		}
		if (scan.status === "queued") {
			const executionPolicy = asWorkspaceGrantRecord(metadata.executionPolicy);
			const runner =
				executionPolicy.runner === "host" || executionPolicy.runner === "docker"
					? executionPolicy.runner
					: resolveScanExecutionPolicy({
							env: this.deps.env,
							surface: "web",
						}).runner;
			await this.deps.scanSupervisor.launch(
				scan.id,
				workspaceGrantScanArgs({
					scanRunId: scan.id,
					projectId: params.grant.projectId,
					grantRef: params.grant.grantRef,
					profileRef: scan.profile,
					targetDigest: params.grant.previewTargetDigest,
					runner,
				}),
			);
		}
		return providerWorkspaceTargetStartResponseSchema.parse({
			version: 1,
			grantRef: params.grant.grantRef,
			scanRunRef: scan.id,
			status: scan.status,
			resolvedProfileRef: scan.profile,
			target: {
				kind: "working_tree",
				digest: params.grant.previewTargetDigest,
				sourceRevision: params.grant.previewSourceRevision,
				providerWorkspaceStateDigest: params.grant.previewWorkspaceStateDigest,
			},
			createdAt: scan.createdAt.toISOString(),
			replayed: params.replayed,
		});
	}

	private async buildPlan(
		client: AuthenticatedIntegrationClient,
		grant: GrantRow,
		selection: ProviderWorkspaceTargetPreviewRequest["selection"],
	): Promise<WorkspacePlan> {
		if (this.planBuilder) {
			return await this.planBuilder({ client, grant, selection });
		}
		return await buildWorkspaceGrantPlan({
			client,
			grant,
			selection,
			allowedProfileRefs: this.deps.env.nightworkersIntegrationAllowedProfiles,
			captureState: this.captureState,
		});
	}

	private assertEnabled(): void {
		if (!this.deps.env.nightworkersSecurityIntelligenceWorkspaceGrantEnabled) {
			throw new NightworkersIntegrationError(
				"provider_temporarily_unavailable",
				"Workspace target grants are unavailable.",
			);
		}
	}

	private now(): Date {
		return this.deps.now?.() ?? new Date();
	}
}
