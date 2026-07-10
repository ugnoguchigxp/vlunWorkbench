import { describe, expect, it } from "vitest";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import { buildStaticIntelligenceModuleCandidates } from "./module-candidates";
import { buildStaticIntelligenceOntologyHandoff } from "./ontology-handoff";
import type { PersistedStaticIntelligenceGeneration } from "./generation-repository";

describe("Static Intelligence module candidates", () => {
	it("projects deterministic modules without claiming canonical ontology", () => {
		const snapshot = {
			version: "v1",
			generatedAt: "2026-07-10T00:00:00.000Z",
			project: { rootRef: "a".repeat(64), rootPathIncluded: false },
			status: "completed",
			degradedReasons: [],
			files: [
				file("api/routes/app.ts", ["route"], ["createApp"]),
				file("api/modules/service.ts", ["source"], ["service"]),
			],
			edges: [
				{ from: "api/routes/app.ts", to: "api/modules/service.ts", kind: "imports", confidence: 1 },
			],
			packages: [],
			summary: { fileCount: 2, parsedFileCount: 2, skippedFileCount: 0, importEdgeCount: 1, packageDependencyCount: 0, exportedSymbolCount: 2, routeFileCount: 1, handlerFileCount: 0, schemaFileCount: 0, workerFileCount: 0, testFileCount: 0, configFileCount: 0 },
		} satisfies CodeStructureSnapshot;
		const exportPayload = {
			fileRiskIndex: [{ path: "api/routes/app.ts", findingCount: 1, maxSeverity: "high", evidenceQuality: "strong", scanners: ["semgrep"], ruleIds: ["rule"], findingIds: ["finding-1"], evidenceRefs: ["evidence-1"], artifactRefs: [], verificationRefs: [], latestScanRunId: "scan-1" }],
		} as unknown as StaticIntelligenceExportV1;

		const modules = buildStaticIntelligenceModuleCandidates({ snapshot, exportPayload });
		expect(modules.map((module) => module.pathPrefix)).toEqual(["api/routes", "api/modules"]);
		expect(modules[0]).toMatchObject({
			entrypointFiles: ["api/routes/app.ts"],
			internalDependencies: ["api/modules"],
			risk: { findingCount: 1, maxSeverity: "high" },
		});
		expect(JSON.stringify(modules)).not.toContain("capability");
	});

	it("preserves already-qualified evidence refs in ontology handoff", () => {
		const snapshot = {
			version: "v1",
			generatedAt: "2026-07-10T00:00:00.000Z",
			project: { id: "project-1", rootRef: "a".repeat(64), rootPathIncluded: false },
			status: "completed",
			degradedReasons: [],
			files: [file("src/app.ts", ["source"], ["app"])],
			edges: [],
			packages: [],
			summary: { fileCount: 1, parsedFileCount: 1, skippedFileCount: 0, importEdgeCount: 0, packageDependencyCount: 0, exportedSymbolCount: 1, routeFileCount: 0, handlerFileCount: 0, schemaFileCount: 0, workerFileCount: 0, testFileCount: 0, configFileCount: 0 },
		} satisfies CodeStructureSnapshot;
		const payload = {
			version: "v1",
			generatedAt: snapshot.generatedAt,
			project: { id: "project-1", name: "Project" },
			scan: { id: "scan-1" },
			scanSummary: { degradedReasons: [] },
			fileRiskIndex: [{ path: "src/app.ts", findingCount: 1, maxSeverity: "high", evidenceQuality: "strong", scanners: ["semgrep"], ruleIds: ["rule"], findingIds: ["finding-1"], evidenceRefs: ["evidence:evidence-1"], artifactRefs: [], verificationRefs: [], latestScanRunId: "scan-1" }],
			graph: { nodes: [], edges: [] },
		} as unknown as StaticIntelligenceExportV1;
		const generation = {
			generationId: "generation-1",
			projectId: "project-1",
			scanRunId: "scan-1",
			status: "available",
			structure: { metadata: { snapshotRef: "snapshot-1", sourceTreeHash: "b".repeat(64), degradedReasons: [] }, snapshot },
			export: { metadata: { exportHash: "c".repeat(64) }, payload },
		} as unknown as PersistedStaticIntelligenceGeneration;

		const handoff = buildStaticIntelligenceOntologyHandoff({ generation });
		expect(handoff.sourceRefs).toContain("evidence:evidence-1");
		expect(handoff.sourceRefs).not.toContain("evidence:evidence:evidence-1");
	});
});

function file(path: string, tags: Array<"route" | "source">, exportedSymbols: string[]) {
	return { path, language: "typescript" as const, moduleKind: "esm" as const, tags, exportedSymbols, imports: [], packageImports: [], contentHash: "b".repeat(64), parseStatus: "parsed" as const, degradedReasons: [] };
}
