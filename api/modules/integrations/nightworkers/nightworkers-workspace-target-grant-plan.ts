import type { ProviderWorkspaceTargetPreviewRequest } from "../../../../shared/schemas/nightworkers-security-intelligence-binding.schema";
import { analyzeProjectCapabilities } from "../../project-capabilities/plugin-detector";
import { buildDiffScanPlan } from "../../scans/diff-scan-plan";
import { resolveGitDiff } from "../../scans/git-diff-resolver";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import type { NightworkersWorkspaceTargetGrantRepository } from "./nightworkers-workspace-target-grant.repository";
import type {
	captureWorkspaceTargetState,
	CapturedWorkspaceTargetState,
} from "./nightworkers-workspace-target-state";
import { resolveNightworkersProfile } from "./nightworkers-scan-preset-registry";

export type WorkspaceGrantRow = NonNullable<
	Awaited<
		ReturnType<NightworkersWorkspaceTargetGrantRepository["findForClient"]>
	>
>;

export type WorkspacePlan = {
	profileRef: string;
	target: ReturnType<typeof buildDiffScanPlan>["target"];
	fileCount: number;
	state: CapturedWorkspaceTargetState;
};

export type WorkspacePlanBuilder = (params: {
	client: AuthenticatedIntegrationClient;
	grant: WorkspaceGrantRow;
	selection: ProviderWorkspaceTargetPreviewRequest["selection"];
}) => Promise<WorkspacePlan>;

export async function buildWorkspaceGrantPlan(params: {
	client: AuthenticatedIntegrationClient;
	grant: WorkspaceGrantRow;
	selection: ProviderWorkspaceTargetPreviewRequest["selection"];
	allowedProfileRefs: readonly string[];
	captureState: typeof captureWorkspaceTargetState;
}): Promise<WorkspacePlan> {
	const state = await params.captureState({
		workspacePath: params.grant.canonicalWorkspacePath,
		allowedRoots: params.client.allowedRoots,
	});
	const profile = resolveNightworkersProfile({
		selection: params.selection,
		targetKind: "working_tree",
		allowedProfileRefs: params.allowedProfileRefs,
	});
	const analysis = await analyzeProjectCapabilities(
		state.canonicalWorkspacePath,
	);
	const plan = buildDiffScanPlan({
		resolved: await resolveGitDiff({
			projectPath: state.canonicalWorkspacePath,
			target: { kind: "working_tree", includeUntracked: true },
			scope: profile.scope,
		}),
		tools: profile.tools,
		detectedPluginIds: analysis.detections
			.filter((item) => item.detected)
			.map((item) => item.pluginId),
		projectInventoryPaths: analysis.context.inventory.map((item) => item.path),
	});
	return {
		profileRef: profile.id,
		target: plan.target,
		fileCount: plan.target.changedFileCount,
		state,
	};
}

export async function requireActiveWorkspaceGrant(params: {
	repository: NightworkersWorkspaceTargetGrantRepository;
	client: AuthenticatedIntegrationClient;
	grantRef: string;
	now: Date;
}): Promise<WorkspaceGrantRow> {
	const grant = await params.repository.findForClient({
		grantRef: params.grantRef,
		integrationClientId: params.client.id,
	});
	if (
		!grant ||
		grant.ownerUserId !== params.client.ownerUserId ||
		grant.consumedAt
	) {
		throw new NightworkersIntegrationError(
			"project_not_found",
			"The workspace target grant was not found.",
		);
	}
	assertWorkspaceGrantFresh(grant, params.now);
	return grant;
}

export function assertWorkspaceGrantFresh(
	grant: WorkspaceGrantRow,
	now: Date,
): void {
	if (grant.expiresAt.getTime() <= now.getTime()) {
		throw new NightworkersIntegrationError(
			"preview_expired",
			"The workspace target grant expired.",
		);
	}
}

export function assertCapturedWorkspaceGrantState(
	grant: WorkspaceGrantRow,
	state: CapturedWorkspaceTargetState,
): void {
	if (
		grant.expectedGitCommonDirDigest !== state.gitCommonDirDigest ||
		grant.expectedHeadSha !== state.headSha ||
		grant.providerWorkspaceStateDigest !== state.workspaceStateDigest
	) {
		throw new NightworkersIntegrationError(
			"target_digest_mismatch",
			"The workspace target state changed after grant creation.",
		);
	}
}
