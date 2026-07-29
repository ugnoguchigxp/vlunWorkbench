import { describe, expect, it } from "bun:test";
import {
	normalizeScannerOutputText,
	normalizeStructuredOutputPaths,
} from "./diff-output-paths";

describe("diff output path normalization", () => {
	it("rewrites host and container scanner paths without touching messages", () => {
		const root = "/tmp/snapshot/project";
		expect(
			normalizeStructuredOutputPaths(
				{
					results: [
						{
							path: "/tmp/snapshot/project/src/app.ts",
							Target: "/workspace/repo/package-lock.json",
							File: "/private/tmp/scanner-output/secret.ts",
							message: "/tmp/snapshot/project must not be rewritten here",
						},
					],
				},
				root,
			),
		).toEqual({
			results: [
				{
					path: "src/app.ts",
					Target: "package-lock.json",
					File: "__external__/secret.ts",
					message: "/tmp/snapshot/project must not be rewritten here",
				},
			],
		});
	});

	it("normalizes safe segments and quarantines nested traversal paths", () => {
		const root = "/tmp/snapshot/project";
		expect(
			normalizeStructuredOutputPaths(
				{
					results: [
						{ path: "src/generated/../app.ts" },
						{ path: "src/../../etc/passwd" },
						{ path: "/workspace/repo/src/../../private/key.txt" },
						{ path: "/tmp/snapshot/project/..config/rule.yml" },
					],
				},
				root,
			),
		).toEqual({
			results: [
				{ path: "src/app.ts" },
				{ path: "__external__/passwd" },
				{ path: "__external__/key.txt" },
				{ path: "..config/rule.yml" },
			],
		});
	});

	it("removes host and container snapshot roots from scanner logs", () => {
		expect(
			normalizeScannerOutputText(
				"host=/tmp/snapshot/project/src/app.ts docker=/workspace/repo/src/app.ts sibling=/tmp/snapshot/project-other/file",
				"/tmp/snapshot/project",
			),
		).toBe(
			"host=./src/app.ts docker=./src/app.ts sibling=/tmp/snapshot/project-other/file",
		);
	});
});
