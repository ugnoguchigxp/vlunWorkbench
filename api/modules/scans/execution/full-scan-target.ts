import { createHash } from "node:crypto";
import type { ScanScopePolicy } from "../../../../shared/schemas/scan-profile.schema";
import { buildDiffScanPlan, canonicalJson } from "./diff/diff-scan-plan";
import { resolveGitDiff } from "./diff/git-diff-resolver";

export type ResolvedFullScanTarget = {
	digest: string;
	sourceRevision: string;
	changedFileCount: number;
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
	const digest = createHash("sha256")
		.update(
			canonicalJson({
				schemaVersion: 1,
				kind: "full",
				sourceRevision,
				workingTreeDigest: workingTree.target.targetDigest,
			}),
		)
		.digest("hex");
	return {
		digest,
		sourceRevision,
		changedFileCount: workingTree.target.changedFileCount,
	};
}
