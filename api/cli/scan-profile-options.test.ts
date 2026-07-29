import { describe, expect, it } from "bun:test";
import { parseScanTargetOption } from "./scan-profile-options";

describe("scan profile target options", () => {
	it("parses commit, range, and working-tree targets", () => {
		expect(
			parseScanTargetOption({ target: "commit", head: "abc123" }),
		).toEqual({ kind: "commit", head: "abc123" });
		expect(
			parseScanTargetOption({
				target: "range",
				base: "main",
				head: "feature",
			}),
		).toEqual({ kind: "range", base: "main", head: "feature" });
		expect(
			parseScanTargetOption({
				target: "working-tree",
				base: "HEAD",
				"include-untracked": "false",
			}),
		).toEqual({
			kind: "working_tree",
			base: "HEAD",
			includeUntracked: false,
		});
	});

	it("rejects incomplete and conflicting target options", () => {
		expect(() => parseScanTargetOption({ target: "commit" })).toThrow();
		expect(() =>
			parseScanTargetOption({
				target: "range",
				base: "main",
			}),
		).toThrow();
		expect(() =>
			parseScanTargetOption({
				target: "working-tree",
				head: "HEAD",
			}),
		).toThrow("--head is not valid");
		expect(() =>
			parseScanTargetOption({ target: "full", base: "HEAD" }),
		).toThrow("not valid with --target full");
		expect(() =>
			parseScanTargetOption({
				target: "full",
				"expected-target-digest": "a".repeat(64),
			}),
		).toThrow("not valid with --target full");
		expect(() =>
			parseScanTargetOption({
				target: "commit",
				head: "HEAD",
				"include-untracked": "true",
			}),
		).toThrow("only valid with --target working-tree");
		expect(() =>
			parseScanTargetOption({
				target: "working-tree",
				"include-untracked": "yes",
			}),
		).toThrow("must be true or false");
		expect(() =>
			parseScanTargetOption({
				target: "commit",
				head: "HEAD\tmalformed",
			}),
		).toThrow("invalid character");
	});
});
