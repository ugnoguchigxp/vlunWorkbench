import { and, eq } from "drizzle-orm";
import type { ScanTarget } from "../../../../shared/schemas/scan-target.schema";
import type { AppDatabase } from "../../../db";
import { nightworkersWorkspaceTargetGrants } from "../../../db/schema";
import { NightworkersWorkspaceTargetGrantRepository } from "./nightworkers-workspace-target-grant.repository";
import { captureWorkspaceTargetState } from "./nightworkers-workspace-target-state";

export async function resolveWorkspaceTargetGrantPath(params: {
	db: AppDatabase;
	grantRef: string;
	projectId: string;
	scanRunId: string | undefined;
	executionSurface: string;
	target: ScanTarget;
	expectedTargetDigest: string | undefined;
}): Promise<string> {
	if (
		!/^siwg:v1:[a-f0-9]{64}$/.test(params.grantRef) ||
		params.executionSurface !== "web" ||
		params.target.kind !== "working_tree" ||
		!params.scanRunId ||
		!params.expectedTargetDigest ||
		!/^[a-f0-9]{64}$/.test(params.expectedTargetDigest)
	) {
		throw new Error("WORKSPACE_TARGET_GRANT_INVALID");
	}
	const scanRunId = params.scanRunId;
	const repository = new NightworkersWorkspaceTargetGrantRepository(params.db);
	const grant =
		(await params.db.query.nightworkersWorkspaceTargetGrants.findFirst({
			where: and(
				eq(nightworkersWorkspaceTargetGrants.grantRef, params.grantRef),
				eq(nightworkersWorkspaceTargetGrants.projectId, params.projectId),
			),
		})) ?? null;
	if (!grant || grant.consumedScanRunId !== scanRunId || !grant.consumedAt) {
		throw new Error("WORKSPACE_TARGET_GRANT_BINDING_MISMATCH");
	}
	let state: Awaited<ReturnType<typeof captureWorkspaceTargetState>>;
	try {
		state = await captureWorkspaceTargetState({
			workspacePath: grant.canonicalWorkspacePath,
			allowedRoots: [grant.canonicalWorkspacePath],
		});
	} finally {
		await repository.clearWorkspacePathForScan({
			grantRef: params.grantRef,
			scanRunId,
		});
	}
	if (
		state.gitCommonDirDigest !== grant.expectedGitCommonDirDigest ||
		state.headSha !== grant.expectedHeadSha ||
		state.workspaceStateDigest !== grant.providerWorkspaceStateDigest
	) {
		throw new Error("WORKSPACE_TARGET_GRANT_STATE_MISMATCH");
	}
	return state.canonicalWorkspacePath;
}
