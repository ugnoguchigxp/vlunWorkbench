import { describe, expect, it } from "vitest";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import {
	buildProjectExplorationCatalog,
	type ProjectExplorationGenerationView,
} from "./exploration-catalog";

const HASH = "a".repeat(64);
const GENERATED_AT = "2026-07-14T12:00:00.000Z";

describe("Project exploration catalog", () => {
	it("collects and deterministically ranks exact, import, test, and verification clues", () => {
		const result = buildProjectExplorationCatalog({
			generation: generation(),
			readiness: "available",
			focus: { paths: ["api/users/service.ts"] },
			generatedAt: GENERATED_AT,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.likelyFiles.slice(0, 4).map(({ path }) => path)).toEqual([
			"api/users/service.ts",
			"api/users/schema.ts",
			"api/orders/service.ts",
			"api/users/index.ts",
		]);
		expect(result.likelyFiles[0]).toMatchObject({
			rank: 1,
			reasonCodes: ["focus_path_exact"],
			sourceRefs: ["file:api/users/service.ts"],
		});
		expect(result.relatedTests.map(({ path }) => path)).toEqual([
			"api/users/users.test.ts",
			"api/users/integration.test.ts",
		]);
		expect(result.relatedTests[0].reasonCodes).toContain(
			"direct_test_importer",
		);
		expect(result.verificationCandidates).toHaveLength(4);
		expect(result.verificationCandidates[0]).toMatchObject({
			rank: 1,
			candidateOnly: true,
			command: "bun run build",
		});
		expect(result.truncation.omittedVerificationCommands).toBe(1);
		expect(JSON.stringify(result)).not.toMatch(
			/SECRET_SOURCE_BODY|\/private\/repo|rootPath|snippet|body/,
		);
	});

	it("resolves module and lexical focus without mixing tests into likely files", () => {
		const base = generation();
		const moduleResult = buildProjectExplorationCatalog({
			generation: base,
			readiness: "available",
			focus: { moduleIds: ["api/users"] },
			generatedAt: GENERATED_AT,
		});
		expect(moduleResult.ok).toBe(true);
		if (!moduleResult.ok) throw new Error(moduleResult.message);
		expect(moduleResult.focusResolution.matchedModuleIds).toEqual([
			"api/users",
		]);
		expect(moduleResult.likelyFiles[0]).toMatchObject({
			path: "api/users/index.ts",
			reasonCodes: expect.arrayContaining(["module_entrypoint"]),
		});
		expect(moduleResult.likelyFiles.every((file) => !file.path.endsWith(".test.ts"))).toBe(true);

		const termResult = buildProjectExplorationCatalog({
			generation: base,
			readiness: "available",
			focus: { terms: ["GetUser", "orders"] },
			generatedAt: GENERATED_AT,
		});
		expect(termResult.ok).toBe(true);
		if (!termResult.ok) throw new Error(termResult.message);
		expect(termResult.focusResolution.matchedTerms).toEqual([
			"get-user",
			"orders",
		]);
		expect(
			termResult.likelyFiles.find((file) => file.path === "api/users/service.ts")
				?.reasonCodes,
		).toContain("exported_symbol_match");
		expect(termResult.likelyFiles.some((file) => file.path === "zod")).toBe(
			false,
		);
	});

	it("ranks direct multi-term and normalized lexical matches before graph neighbors", () => {
		const fixture = generation();
		fixture.structure.snapshot.files.push(
			file(
				"shared/http/http-client.ts",
				["source"],
				["createHttpClient"],
				["requestValidation", "remediation"],
			),
		);
		fixture.structure.snapshot.summary = summary(
			fixture.structure.snapshot.files,
		);
		const result = buildProjectExplorationCatalog({
			generation: fixture,
			readiness: "available",
			focus: {
				terms: ["users", "GetUser", "httpClients", "request validations"],
			},
			generatedAt: GENERATED_AT,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.focusResolution.matchedTerms).toEqual([
			"get-user",
			"http-clients",
			"request validations",
			"users",
		]);
		expect(result.likelyFiles[0]?.path).toBe("api/users/service.ts");
		expect(
			result.likelyFiles.find(
				(candidate) => candidate.path === "shared/http/http-client.ts",
			)?.reasonCodes,
		).toEqual(expect.arrayContaining(["exported_symbol_match", "path_term_match"]));
		expect(
			result.likelyFiles.find(
				(candidate) => candidate.path === "shared/http/http-client.ts",
			)?.reasonCodes,
		).toContain("declared_identifier_match");
	});

	it("ranks the test whose path best matches the focus before broad importers", () => {
		const fixture = generation();
		fixture.structure.snapshot.files.push(
			file("api/users/schema.test.ts", ["test"], []),
		);
		fixture.structure.snapshot.edges.push({
			from: "api/users/schema.test.ts",
			to: "api/users/schema.ts",
			kind: "imports",
			confidence: 1,
		});
		fixture.structure.snapshot.summary = summary(
			fixture.structure.snapshot.files,
		);

		const result = buildProjectExplorationCatalog({
			generation: fixture,
			readiness: "available",
			focus: { terms: ["users", "schemas"] },
			generatedAt: GENERATED_AT,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.likelyFiles[0]?.path).toBe("api/users/schema.ts");
		expect(result.relatedTests[0]?.path).toBe("api/users/schema.test.ts");
	});

	it("returns a focus-matching CLI test even without a static import edge", () => {
		const fixture = generation();
		fixture.structure.snapshot.files.push(
			file("api/users/user-schema-cli.test.ts", ["test"], []),
		);
		fixture.structure.snapshot.summary = summary(
			fixture.structure.snapshot.files,
		);

		const result = buildProjectExplorationCatalog({
			generation: fixture,
			readiness: "available",
			focus: { terms: ["user", "schema", "cli"] },
			generatedAt: GENERATED_AT,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.relatedTests[0]).toMatchObject({
			path: "api/users/user-schema-cli.test.ts",
			reasonCodes: expect.arrayContaining(["test_path_term_match"]),
		});
	});

	it("reports distinct degraded conditions and unmatched focus", () => {
		const fixture = generation();
		fixture.status = "degraded";
		fixture.structure.snapshot.status = "partial";
		fixture.structure.snapshot.degradedReasons = ["unresolved relative import"];
		fixture.export.payload.handoff = undefined;
		const result = buildProjectExplorationCatalog({
			generation: fixture,
			readiness: "stale",
			focus: {
				paths: ["missing.ts"],
				moduleIds: ["module:missing"],
				terms: ["not-present"],
			},
			generatedAt: GENERATED_AT,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.status).toBe("degraded");
		expect(result.focusResolution.unmatched).toEqual([
			"missing.ts",
			"module:missing",
			"not-present",
		]);
		expect(result.degradedReasons).toEqual(
			expect.arrayContaining([
				"generation_stale",
				"generation_degraded",
				"focus_path_unmatched",
				"focus_module_unmatched",
				"focus_terms_unmatched",
				"code_structure_partial",
				"unresolved_relative_imports",
				"related_tests_missing",
				"verification_candidates_missing",
			]),
		);
	});

	it("enforces response budgets without slicing JSON", () => {
		const fixture = generation();
		fixture.structure.snapshot.files = Array.from({ length: 60 }, (_, index) =>
			file(`api/large/file-${String(index).padStart(2, "0")}.ts`, ["source"], [
				`LargeSymbol${index}`,
			]),
		);
		fixture.structure.snapshot.summary = summary(fixture.structure.snapshot.files);
		const result = buildProjectExplorationCatalog({
			generation: fixture,
			readiness: "available",
			focus: { terms: ["large"] },
			limits: { files: 20, tests: 10, verificationCommands: 6 },
			generatedAt: GENERATED_AT,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(
			8 * 1024,
		);
		expect(result.truncation.truncated).toBe(true);
		expect(result.truncation.omittedFiles).toBeGreaterThan(0);

		const oversized = generation();
		oversized.structure.metadata.snapshotRef = "x".repeat(13 * 1024);
		const failure = buildProjectExplorationCatalog({
			generation: oversized,
			readiness: "available",
			focus: { paths: ["api/users/service.ts"] },
			generatedAt: GENERATED_AT,
		});
		expect(failure).toMatchObject({
			ok: false,
			status: "failed",
			reasonCode: "catalog_unavailable",
		});
		expect(() => JSON.parse(JSON.stringify(failure))).not.toThrow();
	});

	it("is stable when persisted input arrays are reversed", () => {
		const original = generation();
		const reversed = structuredClone(original);
		reversed.structure.snapshot.files.reverse();
		for (const file of reversed.structure.snapshot.files) {
			file.tags.reverse();
			file.exportedSymbols.reverse();
			file.identifiers?.reverse();
			file.imports.reverse();
			file.packageImports.reverse();
			file.degradedReasons.reverse();
		}
		reversed.structure.snapshot.edges.reverse();
		reversed.structure.snapshot.packages.reverse();
		reversed.structure.snapshot.degradedReasons.reverse();
		reversed.export.payload.fileRiskIndex.reverse();
		reversed.export.payload.graph.nodes.reverse();
		reversed.export.payload.graph.edges.reverse();
		reversed.export.payload.handoff?.verificationCommands.reverse();
		const input = {
			readiness: "available" as const,
			focus: {
				paths: ["api/users/service.ts"],
				moduleIds: ["api/users"],
				terms: ["orders", "GetUser"],
			},
			generatedAt: GENERATED_AT,
		};
		expect(
			buildProjectExplorationCatalog({ ...input, generation: reversed }),
		).toEqual(buildProjectExplorationCatalog({ ...input, generation: original }));
	});
});

function generation(): ProjectExplorationGenerationView {
	const files: CodeStructureSnapshot["files"] = [
		file("api/users/index.ts", ["handler", "source"], ["handleUser"]),
		file("api/users/service.ts", ["source"], ["getUser"]),
		file("api/users/schema.ts", ["schema"], ["userSchema"]),
		file("api/users/db.ts", ["source"], ["userTable"]),
		file("api/orders/index.ts", ["handler", "source"], ["handleOrder"]),
		file("api/orders/service.ts", ["source"], ["getOrder"]),
		file("shared/config.ts", ["config"], ["config"]),
		file("src/main.ts", ["source"], ["main"]),
		file("api/users/users.test.ts", ["test"], []),
		file("api/users/integration.test.ts", ["test"], []),
		file("api/orders/orders.test.ts", ["test"], []),
	];
	const snapshot: CodeStructureSnapshot = {
		version: "v1",
		generatedAt: GENERATED_AT,
		project: { id: "project-1", rootRef: HASH, rootPathIncluded: false },
		status: "completed",
		degradedReasons: [],
		files,
		edges: [
			{ from: "api/users/index.ts", to: "api/users/service.ts", kind: "imports", confidence: 1 },
			{ from: "api/users/service.ts", to: "api/users/schema.ts", kind: "imports", confidence: 1 },
			{ from: "api/orders/service.ts", to: "api/users/service.ts", kind: "imports", confidence: 1 },
			{ from: "api/users/users.test.ts", to: "api/users/service.ts", kind: "imports", confidence: 1 },
			{ from: "api/users/integration.test.ts", to: "api/users/index.ts", kind: "imports", confidence: 1 },
			{ from: "api/orders/orders.test.ts", to: "api/orders/service.ts", kind: "imports", confidence: 1 },
			{ from: "api/users/service.ts", to: "zod", kind: "depends_on_package", confidence: 1 },
		],
		packages: [{ name: "zod", importedBy: ["api/users/service.ts"] }],
		summary: summary(files),
	};
	const exportPayload: StaticIntelligenceExportV1 = {
		version: "v1",
		generatedAt: GENERATED_AT,
		project: { id: "project-1", name: "Fixture" },
		scan: {
			id: "scan-1",
			profile: "full",
			status: "completed",
			startedAt: GENERATED_AT,
			completedAt: GENERATED_AT,
			findingCount: 0,
			toolRunCount: 0,
			artifactCount: 0,
			reviewStatus: "completed",
		},
		scanSummary: { riskBand: "none", evidenceQuality: "none", degradedReasons: [] },
		fileRiskIndex: [],
		graph: { nodes: [], edges: [] },
		handoff: {
			title: "Fixture",
			objective: "Verify fixture",
			acceptanceCriteria: [],
			verificationCommands: [
				"bun test",
				"bun run typecheck",
				"bun run lint",
				"bun run verify",
				"bun run build",
			],
			constraints: [],
			nonGoals: [],
		},
	};
	return {
		projectId: "project-1",
		scanRunId: "scan-1",
		generationId: "00000000-0000-4000-8000-000000000001",
		status: "available",
		structure: {
			metadata: {
				generatedAt: GENERATED_AT,
				rootRef: HASH,
				snapshotRef: "code_structure:fixture",
				sourceTreeHash: HASH,
				sourceStateHash: "b".repeat(64),
				sourceRevision: { kind: "git", head: "abc123", value: "abc123" },
			},
			snapshot,
		},
		export: { payload: exportPayload },
	};
}

function file(
	path: string,
	tags: CodeStructureSnapshot["files"][number]["tags"],
	exportedSymbols: string[],
	identifiers?: string[],
): CodeStructureSnapshot["files"][number] {
	return {
		path,
		language: "typescript",
		moduleKind: "esm",
		tags,
		exportedSymbols,
		identifiers,
		imports: [],
		packageImports: [],
		contentHash: HASH,
		parseStatus: "parsed",
		degradedReasons: [],
	};
}

function summary(files: CodeStructureSnapshot["files"]): CodeStructureSnapshot["summary"] {
	const count = (tag: CodeStructureSnapshot["files"][number]["tags"][number]) =>
		files.filter((file) => file.tags.includes(tag)).length;
	return {
		fileCount: files.length,
		parsedFileCount: files.length,
		skippedFileCount: 0,
		importEdgeCount: 0,
		packageDependencyCount: 0,
		exportedSymbolCount: files.reduce((total, file) => total + file.exportedSymbols.length, 0),
		routeFileCount: count("route"),
		handlerFileCount: count("handler"),
		schemaFileCount: count("schema"),
		workerFileCount: count("worker"),
		testFileCount: count("test"),
		configFileCount: count("config"),
	};
}
