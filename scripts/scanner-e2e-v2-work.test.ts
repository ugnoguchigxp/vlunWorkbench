import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { observeScannerE2EWork } from "./scanner-e2e-v2-work";

let root: string | null = null;

afterEach(async () => {
	if (root) await fs.rm(root, { recursive: true, force: true });
	root = null;
});

test("collects counters from structured artifacts, persisted coverage, and immutable inputs", async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-e2e-work-"));
	const source = path.join(root, "source");
	const artifactRoot = path.join(root, "artifacts");
	await fs.mkdir(source, { recursive: true });
	await fs.writeFile(path.join(source, "package.json"), JSON.stringify({ dependencies: { a: "1" }, devDependencies: { b: "1" } }));
	await fs.writeFile(path.join(source, "source.ts"), "export const value = 1;\n");
	await fs.mkdir(path.join(source, ".github/workflows"), { recursive: true });
	await fs.writeFile(
		path.join(source, ".github/workflows/verify.yml"),
		"name: verify\non: push\njobs: {}\n",
	);
	await fs.writeFile(path.join(source, "openapi.yaml"), "paths:\n  /health:\n    get:\n      operationId: getHealth\n");
	const rawPath = path.join(artifactRoot, "run/owners/tool-run/tool/raw/raw_result.json");
	await fs.mkdir(path.dirname(rawPath), { recursive: true });
	await fs.writeFile(rawPath, JSON.stringify({ Results: [{ Target: "node" }], paths: { scanned: ["source.ts"] }, errors: [], results: [] }));
	const work = await observeScannerE2EWork({
		caseId: "trivy-filesystem",
		sourcePath: source,
		artifactRoot,
		artifacts: [{ kind: "raw_result", path: "run/owners/tool-run/tool/raw/raw_result.json" }],
		toolRuns: [],
		dastRuns: [],
	});
	expect(work).toEqual({ targetsScanned: 1, resultsProduced: 1 });
	await fs.writeFile(
		rawPath,
		JSON.stringify({
			paths: { scanned: ["source.ts"] },
			errors: [{ level: "warn", type: "PartialParsing" }],
			results: [],
		}),
	);
	const semgrep = await observeScannerE2EWork({
		caseId: "semgrep-source",
		sourcePath: source,
		artifactRoot,
		artifacts: [
			{
				kind: "raw_result",
				path: "run/owners/tool-run/tool/raw/raw_result.json",
			},
		],
		toolRuns: [],
		dastRuns: [],
	});
	expect(semgrep).toMatchObject({ filesScanned: 1, parseErrors: 0 });
	await fs.writeFile(rawPath, JSON.stringify([{ ident: "test" }]));
	const zizmor = await observeScannerE2EWork({
		caseId: "zizmor-workflow",
		sourcePath: source,
		artifactRoot,
		artifacts: [
			{
				kind: "raw_result",
				path: "run/owners/tool-run/tool/raw/raw_result.json",
			},
		],
		toolRuns: [],
		dastRuns: [],
	});
	expect(zizmor).toEqual({ workflowsScanned: 1, findingsProduced: 1 });
	const schema = await observeScannerE2EWork({
		caseId: "schemathesis-readonly",
		sourcePath: source,
		artifactRoot,
		artifacts: [],
		toolRuns: [{ metadata: { gatewayMetrics: { forwardedRequests: 2 } } }],
		dastRuns: [],
	});
	expect(schema).toEqual({ operationsSelected: 1, requestsSent: 2, writeOperations: 0 });
});
