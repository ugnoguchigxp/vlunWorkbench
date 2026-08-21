import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverTestFiles, isVitestFile } from "./test-files";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("test file discovery", () => {
	test("excludes generated root directories without hiding nested source modules", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "test-files-"));
		roots.push(root);
		await Promise.all([
			writeTestFile(root, "artifacts/generated.test.ts"),
			writeTestFile(root, "api/modules/artifacts/extract.test.ts"),
			writeTestFile(root, "api/node_modules/package/ignored.test.ts"),
			writeTestFile(root, "shared/example.test.ts"),
		]);

		expect(await discoverTestFiles(root)).toEqual([
			"api/modules/artifacts/extract.test.ts",
			"shared/example.test.ts",
		]);
	});

	test("routes tests that need native bidirectional child pipes through Node", () => {
		expect(
			isVitestFile(
				"api/modules/static-intelligence/static-intelligence-mcp-stdio.test.ts",
			),
		).toBe(true);
		expect(
			isVitestFile("api/modules/dast/playwright-browser-adapter.test.ts"),
		).toBe(true);
		expect(isVitestFile("api/modules/scans/profile-runner.test.ts")).toBe(false);
	});
});

async function writeTestFile(root: string, relativePath: string): Promise<void> {
	const file = path.join(root, relativePath);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, "export {};\n");
}
