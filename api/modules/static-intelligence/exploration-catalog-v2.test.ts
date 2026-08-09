import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProjectStructureSnapshotV2 } from "../../../shared/schemas/project-structure.schema";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import { projectExplorationPathCatalogV2ResultSchema } from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import {
	buildProjectExplorationCatalogV2,
	type ProjectExplorationGenerationV2View,
	summarizeProjectExplorationReadiness,
} from "./exploration-catalog";

const GENERATED_AT = "2026-08-09T00:00:00.000Z";
const HASH = "a".repeat(64);

describe("Project exploration catalog V2", () => {
	it("keeps the cross-repository path-first fixture on the V2 contract", () => {
		const fixture = JSON.parse(
			readFileSync(
				new URL(
					"../../../tests/fixtures/project-exploration-catalog-v2.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		expect(projectExplorationPathCatalogV2ResultSchema.parse(fixture)).toEqual(
			fixture,
		);
	});

	it("uses Project Structure V2 files, references, and module ids across languages", () => {
		const result = buildProjectExplorationCatalogV2({
			generation: generation(),
			readiness: "available",
			focus: {
				paths: ["services/orders/OrderService.java"],
				moduleIds: ["module:orders"],
				terms: ["load orders"],
			},
			generatedAt: GENERATED_AT,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.version).toBe("v2");
		expect(result.source).toEqual({
			structureSchemaVersion: "project-structure-v2",
			snapshotRef: "project_structure:v2:fixture",
			revision: { kind: "git", head: "abc123", value: "abc123" },
		});
		expect(result.focusResolution.matchedModuleIds).toEqual(["module:orders"]);
		expect(result.likelyFiles.map((candidate) => candidate.path)).toEqual(
			expect.arrayContaining([
				"services/orders/OrderService.java",
				"services/orders/load_orders.py",
				"services/orders/store.go",
			]),
		);
		expect(result.relatedTests.map((candidate) => candidate.path)).toContain(
			"services/orders/order_service_test.py",
		);
		expect(result.readiness).toMatchObject({
			usability: "usable",
			coverage: {
				inventoriedFiles: 4,
				analyzedFiles: 4,
				resolvedReferences: 2,
				inferredModules: 1,
			},
		});
	});

	it("classifies critical analysis failure as unusable", () => {
		const snapshot = generation().projectStructure.snapshot;
		snapshot.readiness.analysis = {
			status: "failed",
			reasonCodes: ["analysis_failed"],
		};
		expect(summarizeProjectExplorationReadiness(snapshot)).toMatchObject({
			usability: "unusable",
			reasonCodes: expect.arrayContaining(["analysis_failed"]),
		});
	});

	it("keeps resolution gaps usable and preserves deterministic ordering", () => {
		const original = generation();
		original.projectStructure.snapshot.status = "partial";
		original.projectStructure.snapshot.readiness.resolution = {
			status: "degraded",
			reasonCodes: ["unresolved_import"],
		};
		original.projectStructure.snapshot.summary.unresolvedReferenceCount = 1;
		const reversed = structuredClone(original);
		reversed.projectStructure.snapshot.files.reverse();
		reversed.projectStructure.snapshot.references.reverse();
		reversed.projectStructure.snapshot.modules.reverse();
		for (const module of reversed.projectStructure.snapshot.modules) {
			module.files.reverse();
			module.entrypoints.reverse();
		}
		const input = {
			readiness: "available" as const,
			focus: { moduleIds: ["module:orders"], terms: ["orders"] },
			generatedAt: GENERATED_AT,
		};
		const expected = buildProjectExplorationCatalogV2({
			...input,
			generation: original,
		});
		expect(
			buildProjectExplorationCatalogV2({ ...input, generation: reversed }),
		).toEqual(expected);
		expect(expected).toMatchObject({
			ok: true,
			status: "degraded",
			readiness: {
				usability: "degraded_usable",
				reasonCodes: expect.arrayContaining(["unresolved_import"]),
			},
		});
	});

	it("fails closed when V2 provenance exceeds the hard response budget", () => {
		const oversized = generation();
		oversized.projectStructure.metadata.snapshotRef = "x".repeat(13 * 1024);
		expect(
			buildProjectExplorationCatalogV2({
				generation: oversized,
				readiness: "available",
				focus: { paths: ["services/orders/OrderService.java"] },
				generatedAt: GENERATED_AT,
			}),
		).toMatchObject({
			ok: false,
			status: "failed",
			reasonCode: "catalog_unavailable",
		});
	});
});

function generation(): ProjectExplorationGenerationV2View {
	const projectStructure = projectStructureSnapshot();
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
			snapshot: legacySnapshot(),
		},
		projectStructure: {
			metadata: {
				generatedAt: GENERATED_AT,
				snapshotRef: "project_structure:v2:fixture",
				sourceRevision: { kind: "git", head: "abc123", value: "abc123" },
				schemaVersion: "project-structure-v2",
			},
			snapshot: projectStructure,
		},
		export: { payload: exportPayload() },
	};
}

function projectStructureSnapshot(): ProjectStructureSnapshotV2 {
	const paths = [
		"services/orders/OrderService.java",
		"services/orders/load_orders.py",
		"services/orders/store.go",
		"services/orders/order_service_test.py",
	];
	const files: ProjectStructureSnapshotV2["files"] = [
		v2File(paths[0] as string, "java", ["source"], ["OrderService"]),
		v2File(paths[1] as string, "python", ["source"], ["loadOrders"]),
		v2File(paths[2] as string, "go", ["source"], ["OrderStore"]),
		v2File(paths[3] as string, "python", ["test"], []),
	];
	return {
		version: "v2",
		generatedAt: GENERATED_AT,
		project: { rootRef: HASH, rootPathIncluded: false },
		status: "completed",
		structureInputHash: "c".repeat(64),
		inventory: {
			entries: paths.map((path, index) => ({
				path,
				realPathRef: String(index + 1).repeat(64).slice(0, 64),
				kind: "source" as const,
				mediaType: "text/plain",
				sizeBytes: 10,
				hashMode: "content" as const,
				contentHash: HASH,
				analyzerIds: ["fixture"],
			})),
			coverage: {
				discoveredFileCount: 4,
				includedFileCount: 4,
				analyzableFileCount: 4,
				unsupportedFileCount: 0,
				resourceFileCount: 0,
				excludedFileCount: 0,
				excludedByReason: {},
				unhashedFileCount: 0,
				totalIncludedBytes: 40,
				budgetHit: false,
			},
		},
		files,
		references: [
			{
				from: paths[0] as string,
				specifier: "./store",
				kind: "code_module",
				status: "resolved",
				target: paths[2],
				resolverId: "fixture",
				confidence: 1,
				diagnosticCodes: [],
			},
			{
				from: paths[3] as string,
				specifier: "OrderService",
				kind: "code_module",
				status: "resolved",
				target: paths[0],
				resolverId: "fixture",
				confidence: 1,
				diagnosticCodes: [],
			},
		],
		modules: [
			{
				id: "module:orders",
				label: "orders",
				pathPrefix: "services/orders",
				boundaryKind: "directory",
				files: paths,
				entrypoints: [paths[0] as string],
				internalDependencies: [],
				externalDependencies: [],
				confidence: 0.9,
				confidenceReasons: ["fixture"],
			},
		],
		packages: [],
		diagnostics: [],
		readiness: {
			inventory: { status: "available", reasonCodes: [] },
			analysis: { status: "available", reasonCodes: [] },
			resolution: { status: "available", reasonCodes: [] },
			moduleInference: { status: "available", reasonCodes: [] },
		},
		summary: {
			fileCount: 4,
			analyzedFileCount: 4,
			styleFileCount: 0,
			markupFileCount: 0,
			resourceFileCount: 0,
			resolvedReferenceCount: 2,
			unresolvedReferenceCount: 0,
			moduleCount: 1,
		},
	};
}

function v2File(
	path: string,
	language: string,
	tags: ProjectStructureSnapshotV2["files"][number]["tags"],
	exportedSymbols: string[],
): ProjectStructureSnapshotV2["files"][number] {
	return {
		path,
		analyzerId: `fixture-${language}`,
		language,
		moduleKind: "unknown",
		tags,
		exportedSymbols,
		identifiers: exportedSymbols,
		contentHash: HASH,
		status: "analyzed",
		diagnosticCodes: [],
	};
}

function legacySnapshot(): CodeStructureSnapshot {
	return {
		version: "v1",
		generatedAt: GENERATED_AT,
		project: { rootRef: HASH, rootPathIncluded: false },
		status: "completed",
		degradedReasons: [],
		files: [],
		edges: [],
		packages: [],
		summary: {
			fileCount: 0,
			parsedFileCount: 0,
			skippedFileCount: 0,
			importEdgeCount: 0,
			packageDependencyCount: 0,
			exportedSymbolCount: 0,
			routeFileCount: 0,
			handlerFileCount: 0,
			schemaFileCount: 0,
			workerFileCount: 0,
			testFileCount: 0,
			configFileCount: 0,
		},
	};
}

function exportPayload(): StaticIntelligenceExportV1 {
	return {
		version: "v1",
		generatedAt: GENERATED_AT,
		project: { id: "project-1", name: "Fixture" },
		scan: {
			id: "scan-1",
			profile: "structure",
			status: "completed",
			startedAt: GENERATED_AT,
			completedAt: GENERATED_AT,
			findingCount: 0,
			toolRunCount: 0,
			artifactCount: 0,
			reviewStatus: "completed",
		},
		scanSummary: {
			riskBand: "none",
			evidenceQuality: "none",
			degradedReasons: [],
		},
		fileRiskIndex: [],
		graph: { nodes: [], edges: [] },
		handoff: {
			title: "Fixture",
			objective: "Verify fixture",
			acceptanceCriteria: [],
			verificationCommands: ["go test ./..."],
			constraints: [],
			nonGoals: [],
		},
	};
}
