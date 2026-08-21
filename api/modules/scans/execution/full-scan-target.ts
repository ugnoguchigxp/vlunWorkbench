import { createHash } from "node:crypto";
import type { ScanScopePolicy } from "../../../../shared/schemas/scan-profile.schema";
import { digestScopedFiles } from "../target-scope";
import { buildDiffScanPlan, canonicalJson } from "./diff/diff-scan-plan";
import { resolveGitDiff } from "./diff/git-diff-resolver";

export type ResolvedFullScanTarget = {
	digest: string;
	sourceRevision: string;
	changedFileCount: number;
	scopeContentDigest: string | null;
};

export async function resolveFullScanTarget(
	projectPath: string,
	scope?: ScanScopePolicy,
): Promise<ResolvedFullScanTarget> {
	const workingTree = buildDiffScanPlan({
		resolved: await resolveGitDiff({
			projectPath,
			target: { kind: "working_tree", includeUntracked: true },
			scope,
		}),
		tools: [],
	});
	const sourceRevision = workingTree.target.baseSha;
	const scopeContentDigest = await digestScopedFiles({
		repoPath: projectPath,
		scope,
	});
	const digest = createHash("sha256")
		.update(
			canonicalJson({
				schemaVersion: 1,
				kind: "full",
				sourceRevision,
				workingTreeDigest: workingTree.target.targetDigest,
				scopeContentDigest,
			}),
		)
		.digest("hex");
	return {
		digest,
		sourceRevision,
		changedFileCount: workingTree.target.changedFileCount,
		scopeContentDigest,
	};
}
