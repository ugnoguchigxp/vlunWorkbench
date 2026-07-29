import { describe, expect, it } from "vitest";
import {
	readDiffFindingRelationDisplay,
	readDiffTargetDisplay,
} from "./diff-target-display";

describe("diff target display", () => {
	it("formats working-tree provenance and coverage", () => {
		expect(
			readDiffTargetDisplay({
				target: {
					kind: "working_tree",
					baseSha: "a".repeat(40),
					headSha: null,
					targetDigest: "b".repeat(64),
					requested: {
						kind: "working_tree",
						base: "HEAD",
						includeUntracked: true,
					},
				},
				diffCoverage: {
					changed: 3,
					scannable: 2,
					deleted: 1,
					excluded: 0,
					unsupported: 0,
					tooLarge: 0,
				},
			}),
		).toEqual({
			kind: "working_tree",
			label: "WORKTREE @ aaaaaaa",
			digest: "b".repeat(64),
			coverage: {
				changed: 3,
				scannable: 2,
				deleted: 1,
				excluded: 0,
				unsupported: 0,
				tooLarge: 0,
			},
		});
	});

	it("returns null for a full scan", () => {
		expect(readDiffTargetDisplay({})).toBeNull();
	});

	it("shows requested and resolved range refs", () => {
		expect(
			readDiffTargetDisplay({
				target: {
					kind: "range",
					baseSha: "a".repeat(40),
					headSha: "c".repeat(40),
					targetDigest: "b".repeat(64),
					requested: {
						kind: "range",
						base: "main",
						head: "feature",
					},
				},
			})?.label,
		).toBe("main...feature (aaaaaaa...ccccccc)");
	});

	it("formats finding relations without claiming line-level introduction", () => {
		expect(
			readDiffFindingRelationDisplay({
				diffRelation: { kind: "changed_file", path: "src/app.ts" },
			}),
		).toEqual({ kind: "changed_file", label: "変更ファイル関連" });
		expect(
			readDiffFindingRelationDisplay({
				diffRelation: { kind: "target_state_dependency" },
			}),
		).toEqual({
			kind: "target_state_dependency",
			label: "依存関係の対象状態",
		});
	});
});
