import { describe, expect, it } from "vitest";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceModuleCandidate } from "../../../../shared/schemas/static-intelligence-module.schema";
import type { ProjectStructureSummaryResponse } from "../../api";
import {
	buildModuleRelationshipContext,
	buildStructureMetrics,
	confidenceBand,
	countGraphItems,
	filterModuleCandidates,
	resolveSelectedModule,
} from "./project-intelligence-structure-model";

const generatedAt = "2026-08-09T00:00:00.000Z";

function moduleCandidate(
	id: string,
	pathPrefix: string,
	overrides: Partial<StaticIntelligenceModuleCandidate> = {},
): StaticIntelligenceModuleCandidate {
	return {
		id,
		pathPrefix,
		label: pathPrefix,
		fileCount: 1,
		entrypointFiles: [],
		roleTags: [],
		exportedSymbols: [],
		internalDependencies: [],
		packageDependencies: [],
		risk: {
			findingCount: 0,
			maxSeverity: "unknown",
			evidenceQuality: "none",
			fileRefs: [],
			findingIds: [],
		},
		confidence: 0.8,
		reasons: ["test fixture"],
		...overrides,
	};
}

function exportPayload(findingCount = 0): StaticIntelligenceExportV1 {
	return {
		version: "v1",
		generatedAt,
		project: { id: "p-1", name: "Project" },
		scan: {
			id: "s-1",
			profile: "baseline",
			status: "completed",
			startedAt: generatedAt,
			completedAt: generatedAt,
			findingCount,
			toolRunCount: 1,
			artifactCount: 1,
			reviewStatus: "missing",
		},
		scanSummary: {
			riskBand: findingCount > 0 ? "high" : "none",
			evidenceQuality: findingCount > 0 ? "strong" : "none",
			degradedReasons: [],
		},
		fileRiskIndex: [],
		graph: {
			nodes: [
				{ id: "project:p-1", kind: "project", label: "Project" },
				{ id: "file:src/app.ts", kind: "file", label: "src/app.ts" },
			],
			edges: [
				{
					id: "project:file",
					from: "project:p-1",
					to: "file:src/app.ts",
					kind: "related_to",
					confidence: 1,
					evidenceRefs: [],
				},
			],
		},
	};
}

describe("project Intelligence structure model", () => {
	const auth = moduleCandidate("module:auth", "src/auth", {
		label: "Authentication",
		fileCount: 4,
		entrypointFiles: ["src/auth/index.ts"],
		internalDependencies: ["src/core", "src/missing"],
		packageDependencies: ["jose"],
		confidence: 0.92,
		risk: {
			findingCount: 2,
			maxSeverity: "high",
			evidenceQuality: "strong",
			fileRefs: ["src/auth/index.ts"],
			findingIds: ["f-1", "f-2"],
		},
	});
	const core = moduleCandidate("module:core", "src/core", {
		label: "Core",
		fileCount: 2,
		internalDependencies: ["src/auth"],
		confidence: 0.74,
	});
	const ui = moduleCandidate("module:ui", "src/ui", {
		label: "User interface",
		confidence: 0.6,
	});
	const modules = [ui, core, auth];

	it("filters by confidence, risk overlay, and searchable module facts", () => {
		expect(confidenceBand(auth.confidence)).toBe("high");
		expect(confidenceBand(core.confidence)).toBe("medium");
		expect(confidenceBand(ui.confidence)).toBe("low");
		expect(
			filterModuleCandidates(modules, {
				query: "jose",
				confidence: "all",
				riskOnly: true,
			}).map((module) => module.id),
		).toEqual(["module:auth"]);
	});

	it("uses a stable largest-module fallback for absent URL selections", () => {
		expect(resolveSelectedModule(modules, "module:core")?.id).toBe(
			"module:core",
		);
		expect(resolveSelectedModule(modules, "module:missing")?.id).toBe(
			"module:auth",
		);
		expect(resolveSelectedModule([], null)).toBeNull();
	});

	it("derives inbound, outbound, and unresolved module relationships", () => {
		const context = buildModuleRelationshipContext(modules, auth.id);
		expect(context?.inbound.map((module) => module.id)).toEqual([
			"module:core",
		]);
		expect(context?.outbound.map((module) => module.id)).toEqual([
			"module:core",
		]);
		expect(context?.unresolvedOutbound).toEqual(["src/missing"]);
	});

	it("keeps structure metrics useful when a scan has zero findings", () => {
		const structure: ProjectStructureSummaryResponse = {
			view: "summary",
			status: "available",
			modules,
			coverage: {
				discoveredFileCount: 10,
				includedFileCount: 7,
				analyzableFileCount: 6,
				unsupportedFileCount: 1,
				resourceFileCount: 0,
				excludedFileCount: 3,
				excludedByReason: {},
				unhashedFileCount: 0,
				totalIncludedBytes: 100,
				budgetHit: false,
			},
			summary: {
				fileCount: 7,
				analyzedFileCount: 6,
				styleFileCount: 0,
				markupFileCount: 0,
				resourceFileCount: 0,
				resolvedReferenceCount: 5,
				unresolvedReferenceCount: 1,
				moduleCount: 3,
			},
		};
		const metrics = buildStructureMetrics(structure, exportPayload(0));
		expect(metrics).toMatchObject({
			inventoryFiles: 7,
			analyzedFiles: 6,
			modules: 3,
			resolvedReferences: 5,
			unresolvedReferences: 1,
			findings: 0,
		});
		expect(metrics.entrypoints).toBe(1);
		expect(metrics.packages).toBe(1);
	});

	it("counts diagnostic graph nodes and edges by kind", () => {
		expect(countGraphItems(exportPayload())).toEqual({
			nodes: { project: 1, file: 1 },
			edges: { related_to: 1 },
		});
	});
});
