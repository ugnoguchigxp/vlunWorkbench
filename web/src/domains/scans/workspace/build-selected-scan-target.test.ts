import { describe, expect, it } from "vitest";
import { buildSelectedScanTarget } from "./build-selected-scan-target";

describe("buildSelectedScanTarget", () => {
	it("builds a full-repository target", () => {
		expect(
			buildSelectedScanTarget({
				scanTargetKind: "full",
				diffBaseRef: "main",
				diffHeadRef: "HEAD",
				diffIncludeUntracked: true,
			}),
		).toEqual({ kind: "full" });
	});

	it("builds a commit target and omits an empty base", () => {
		expect(
			buildSelectedScanTarget({
				scanTargetKind: "commit",
				diffBaseRef: "  ",
				diffHeadRef: " abc ",
				diffIncludeUntracked: false,
			}),
		).toEqual({ kind: "commit", head: "abc" });
		expect(
			buildSelectedScanTarget({
				scanTargetKind: "commit",
				diffBaseRef: "main",
				diffHeadRef: "HEAD",
				diffIncludeUntracked: false,
			}),
		).toEqual({ kind: "commit", head: "HEAD", base: "main" });
	});

	it("builds a range target", () => {
		expect(
			buildSelectedScanTarget({
				scanTargetKind: "range",
				diffBaseRef: " main ",
				diffHeadRef: " HEAD ",
				diffIncludeUntracked: false,
			}),
		).toEqual({ kind: "range", base: "main", head: "HEAD" });
	});

	it("builds a working-tree target", () => {
		expect(
			buildSelectedScanTarget({
				scanTargetKind: "working_tree",
				diffBaseRef: "",
				diffHeadRef: "HEAD",
				diffIncludeUntracked: true,
			}),
		).toEqual({ kind: "working_tree", includeUntracked: true });
		expect(
			buildSelectedScanTarget({
				scanTargetKind: "working_tree",
				diffBaseRef: "HEAD",
				diffHeadRef: "HEAD",
				diffIncludeUntracked: false,
			}),
		).toEqual({
			kind: "working_tree",
			base: "HEAD",
			includeUntracked: false,
		});
	});
});
