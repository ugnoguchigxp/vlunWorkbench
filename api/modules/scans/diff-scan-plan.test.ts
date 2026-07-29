import { describe, expect, it } from "bun:test";
import type { ProfileToolEntry } from "../../../shared/schemas/scan-profile.schema";
import type { ResolvedGitDiff } from "./git-diff-resolver";
import {
	buildDiffScanPlan,
	canonicalJson,
	shouldUseChangedWorkspaceForSemgrep,
} from "./diff-scan-plan";

const tools: ProfileToolEntry[] = [
	{
		toolId: "semgrep",
		displayName: "Semgrep",
		required: true,
		failurePolicy: "fail_profile",
	},
	{
		toolId: "gitleaks",
		displayName: "Gitleaks",
		required: true,
		failurePolicy: "fail_profile",
	},
	{
		toolId: "osv",
		displayName: "OSV",
		required: false,
		failurePolicy: "warn_and_continue",
	},
	{
		toolId: "trivy",
		displayName: "Trivy",
		required: false,
		failurePolicy: "warn_and_continue",
	},
];

describe("diff scan plan", () => {
	it("builds deterministic target identity and per-tool applicability", () => {
		const input = resolved([
			entry("src/app.ts"),
			entry("package-lock.json"),
			{
				...entry("old.ts"),
				status: "deleted",
				disposition: "deleted",
				reasonCode: "deleted_path",
				contentSha256: undefined,
				sizeBytes: undefined,
			},
		]);
		const first = buildDiffScanPlan({ resolved: input, tools });
		const second = buildDiffScanPlan({ resolved: input, tools });

		expect(first.target.targetDigest).toBe(second.target.targetDigest);
		expect(first.manifest.coverage).toEqual({
			changed: 3,
			scannable: 2,
			deleted: 1,
			excluded: 0,
			unsupported: 0,
			tooLarge: 0,
		});
		expect(first.dependencyChanged).toBe(true);
		expect(
			first.tools.find((tool) => tool.toolId === "osv")?.applicability,
		).toBe("applicable");
	});

	it("skips dependency scanning when no manifest changed", () => {
		const plan = buildDiffScanPlan({
			resolved: resolved([entry("src/app.ts")]),
			tools,
		});

		expect(plan.tools.find((tool) => tool.toolId === "osv")).toMatchObject({
			applicability: "not_applicable",
			reasonCode: "no_dependency_manifest_changed",
			coverageEffect: "covered",
		});
		expect(plan.tools.find((tool) => tool.toolId === "semgrep")).toMatchObject({
			applicability: "applicable",
			reasonCode: null,
		});
	});

	it("distinguishes an empty diff from partial coverage", () => {
		const empty = buildDiffScanPlan({ resolved: resolved([]), tools });
		expect(
			empty.tools.every(
				(tool) =>
					tool.applicability === "not_applicable" &&
					tool.reasonCode === "no_changed_files" &&
					tool.coverageEffect === "covered",
			),
		).toBe(true);

		const partial = buildDiffScanPlan({
			resolved: resolved([
				{
					...entry("binary.bin"),
					binary: true,
					disposition: "unsupported",
					reasonCode: "binary_not_supported",
				},
			]),
			tools,
		});
		expect(
			partial.tools.every((tool) => tool.coverageEffect === "partial"),
		).toBe(true);
	});

	it("canonicalizes object key order recursively", () => {
		expect(
			canonicalJson({
				z: 1,
				a: { y: true, b: false },
			}),
		).toBe('{"a":{"b":false,"y":true},"z":1}');
	});

	it("falls back to a changed workspace before Semgrep argv becomes unsafe", () => {
		expect(shouldUseChangedWorkspaceForSemgrep(["src/app.ts"])).toBe(false);
		expect(
			shouldUseChangedWorkspaceForSemgrep(
				Array.from({ length: 513 }, (_, index) => `src/${index}.ts`),
			),
		).toBe(true);
	});
});

function resolved(
	entries: ResolvedGitDiff["entries"],
): ResolvedGitDiff {
	return {
		gitRoot: "/repo",
		projectRoot: "/repo",
		projectPrefix: "",
		requested: {
			kind: "working_tree",
			base: "HEAD",
			includeUntracked: true,
		},
		baseSha: "a".repeat(40),
		headSha: null,
		mergeBaseSha: null,
		includeUntracked: true,
		entries,
	};
}

function entry(path: string): ResolvedGitDiff["entries"][number] {
	return {
		status: "modified",
		path,
		contentSha256: "b".repeat(64),
		sizeBytes: 10,
		binary: false,
		inProfileScope: true,
		disposition: "scan",
		reasonCode: null,
	};
}
