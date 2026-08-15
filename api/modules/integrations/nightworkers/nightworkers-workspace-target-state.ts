import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalStringifySecurityIntelligenceValue } from "../../../../shared/security-intelligence-assessment-contract";
import { authorizeProjectPathWithinRoots } from "../../../security/project-path-policy";
import { buildDiffScanPlan } from "../../scans/diff-scan-plan";
import { resolveGitDiff } from "../../scans/git-diff-resolver";
import { runGitText } from "../../scans/git-command";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";

export type CapturedWorkspaceTargetState = {
	canonicalWorkspacePath: string;
	gitCommonDirDigest: `sha256:${string}`;
	headSha: string;
	targetDigest: string;
	workspaceStateDigest: `sha256:${string}`;
	fileCount: number;
};

export async function captureWorkspaceTargetState(params: {
	workspacePath: string;
	allowedRoots: readonly string[];
}): Promise<CapturedWorkspaceTargetState> {
	if (params.allowedRoots.length === 0) {
		throw new NightworkersIntegrationError(
			"project_path_denied",
			"Workspace target grants require an explicit allowed root.",
		);
	}
	let canonicalWorkspacePath: string;
	try {
		canonicalWorkspacePath = (
			await authorizeProjectPathWithinRoots({
				projectPath: params.workspacePath,
				allowedRoots: params.allowedRoots,
			})
		).canonicalPath;
	} catch {
		throw new NightworkersIntegrationError(
			"project_path_denied",
			"The workspace target path is not permitted.",
		);
	}
	try {
		const commonDirOutput = (
			await runGitText({
				cwd: canonicalWorkspacePath,
				args: ["rev-parse", "--git-common-dir"],
			})
		).trim();
		const commonDirPath = await fs.realpath(
			path.isAbsolute(commonDirOutput)
				? commonDirOutput
				: path.resolve(canonicalWorkspacePath, commonDirOutput),
		);
		const headSha = (
			await runGitText({
				cwd: canonicalWorkspacePath,
				args: ["rev-parse", "HEAD"],
			})
		).trim();
		if (!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(headSha)) {
			throw new Error("invalid HEAD");
		}
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: canonicalWorkspacePath,
				target: {
					kind: "working_tree",
					includeUntracked: true,
				},
			}),
			tools: [],
		});
		const gitCommonDirDigest = digest(commonDirPath);
		const workspaceStateDigest = digest(
			canonicalStringifySecurityIntelligenceValue({
				gitCommonDirDigest,
				headSha,
				targetDigest: plan.target.targetDigest,
			}),
		);
		return {
			canonicalWorkspacePath,
			gitCommonDirDigest,
			headSha,
			targetDigest: plan.target.targetDigest,
			workspaceStateDigest,
			fileCount: plan.target.changedFileCount,
		};
	} catch (error) {
		if (error instanceof NightworkersIntegrationError) throw error;
		throw new NightworkersIntegrationError(
			"project_path_denied",
			"The workspace target is not a readable Git worktree.",
		);
	}
}

function digest(value: string): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
