import { describe, expect, it } from "vitest";
import type { CodeStructureSnapshot } from "../../../../shared/schemas/static-intelligence-code-structure.schema";
import { staticIntelligenceExportV1Schema } from "../../../../shared/schemas/static-intelligence.schema";
import { buildCodeStructureExportEnrichment } from "./export-enrichment";

describe("Code Structure export enrichment", () => {
	it("maps completed snapshots to compact available enrichment", () => {
		const enrichment = buildCodeStructureExportEnrichment(snapshotFixture());

		expect(enrichment).toMatchObject({
			status: "available",
			snapshotRef: expect.stringMatching(
				/^code_structure:[a-f0-9]{64}:[a-f0-9]{12}$/,
			),
			fileTagsByPath: {
				"src/app.ts": ["route", "handler", "source"],
				"src/schema.ts": ["schema", "source"],
			},
			degradedReasons: [],
		});
		expect(enrichment?.summary?.fileCount).toBe(2);
		const serialized = JSON.stringify(enrichment);
		expect(serialized).not.toContain("react");
		expect(serialized).not.toContain("App");
		expect(serialized).not.toContain("abc123");
	});

	it("maps partial snapshots to degraded enrichment", () => {
		const enrichment = buildCodeStructureExportEnrichment(
			snapshotFixture({
				status: "partial",
				degradedReasons: ["src/app.ts: unresolved relative imports: ./missing"],
			}),
		);

		expect(enrichment?.status).toBe("degraded");
		expect(enrichment?.degradedReasons).toEqual([
			"src/app.ts: unresolved relative imports: ./missing",
		]);
	});

	it("validates as optional Static Intelligence export field", () => {
		const parsed = staticIntelligenceExportV1Schema.parse({
			version: "v1",
			generatedAt: "2026-07-06T12:00:00.000Z",
			project: { id: "project-1", name: "Target" },
			scan: {
				id: "scan-1",
				profile: "baseline",
				status: "completed",
				startedAt: null,
				completedAt: null,
				findingCount: 0,
				toolRunCount: 0,
				artifactCount: 0,
				reviewStatus: "missing",
			},
			scanSummary: {
				riskBand: "none",
				evidenceQuality: "none",
				degradedReasons: [],
			},
			fileRiskIndex: [],
			graph: { nodes: [], edges: [] },
			codeStructure: buildCodeStructureExportEnrichment(snapshotFixture()),
		});

		expect(parsed.codeStructure?.status).toBe("available");
	});

	it("rejects unexpected code structure enrichment fields", () => {
		expect(() =>
			staticIntelligenceExportV1Schema.parse({
				version: "v1",
				generatedAt: "2026-07-06T12:00:00.000Z",
				project: { id: "project-1", name: "Target" },
				scan: {
					id: "scan-1",
					profile: "baseline",
					status: "completed",
					startedAt: null,
					completedAt: null,
					findingCount: 0,
					toolRunCount: 0,
					artifactCount: 0,
					reviewStatus: "missing",
				},
				scanSummary: {
					riskBand: "none",
					evidenceQuality: "none",
					degradedReasons: [],
				},
				fileRiskIndex: [],
				graph: { nodes: [], edges: [] },
				codeStructure: {
					...buildCodeStructureExportEnrichment(snapshotFixture()),
					files: snapshotFixture().files,
				},
			}),
		).toThrow();
	});
});

function snapshotFixture(
	overrides: Partial<CodeStructureSnapshot> = {},
): CodeStructureSnapshot {
	return {
		version: "v1",
		generatedAt: "2026-07-06T12:00:00.000Z",
		project: {
			rootRef:
				"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			rootPathIncluded: false,
		},
		status: "completed",
		degradedReasons: [],
		files: [
			{
				path: "src/app.ts",
				language: "typescript",
				moduleKind: "esm",
				tags: ["route", "handler", "source"],
				exportedSymbols: ["App"],
				imports: ["react"],
				packageImports: ["react"],
				contentHash:
					"abc1230000000000000000000000000000000000000000000000000000000000",
				parseStatus: "parsed",
				degradedReasons: [],
			},
			{
				path: "src/schema.ts",
				language: "typescript",
				moduleKind: "esm",
				tags: ["schema", "source"],
				exportedSymbols: ["schema"],
				imports: ["zod"],
				packageImports: ["zod"],
				contentHash:
					"def4560000000000000000000000000000000000000000000000000000000000",
				parseStatus: "parsed",
				degradedReasons: [],
			},
		],
		edges: [
			{
				from: "src/app.ts",
				to: "react",
				kind: "depends_on_package",
				confidence: 0.8,
			},
		],
		packages: [{ name: "react", importedBy: ["src/app.ts"] }],
		summary: {
			fileCount: 2,
			parsedFileCount: 2,
			skippedFileCount: 0,
			importEdgeCount: 0,
			packageDependencyCount: 2,
			exportedSymbolCount: 2,
			routeFileCount: 1,
			handlerFileCount: 1,
			schemaFileCount: 1,
			workerFileCount: 0,
			testFileCount: 0,
			configFileCount: 0,
		},
		...overrides,
	};
}
