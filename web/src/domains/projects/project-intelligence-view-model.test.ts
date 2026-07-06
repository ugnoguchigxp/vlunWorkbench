import { describe, expect, it } from "vitest";
import type { DiagnosticEvidenceGraph } from "../../../../shared/schemas/static-intelligence.schema";
import type { ProjectIntelligenceOverview } from "../../api";
import {
	buildProjectCardSummary,
	countGraphKinds,
} from "./project-intelligence-view-model";

describe("project intelligence view model", () => {
	it("builds an empty project summary when intelligence is missing", () => {
		expect(buildProjectCardSummary(null)).toEqual({
			riskBand: "none",
			evidenceQuality: "missing",
			findingCount: 0,
			codeStructureStatus: "missing",
			scanStatus: "none",
			hasDegradedReasons: false,
		});
	});

	it("builds project card values from the latest export", () => {
		const overview = {
			latestScan: { status: "completed" },
			latestExport: {
				scan: { findingCount: 2 },
				scanSummary: {
					riskBand: "high",
					evidenceQuality: "strong",
				},
			},
			availability: { codeStructure: "degraded" },
			degradedReasons: ["code structure partial"],
		} as ProjectIntelligenceOverview;

		expect(buildProjectCardSummary(overview)).toMatchObject({
			riskBand: "high",
			evidenceQuality: "strong",
			findingCount: 2,
			codeStructureStatus: "degraded",
			scanStatus: "completed",
			hasDegradedReasons: true,
		});
	});

	it("counts evidence graph node and edge kinds", () => {
		const graph: DiagnosticEvidenceGraph = {
			nodes: [
				{ id: "project:p-1", kind: "project", label: "Project" },
				{ id: "finding:f-1", kind: "finding", label: "Finding" },
				{ id: "finding:f-2", kind: "finding", label: "Finding" },
			],
			edges: [
				{
					id: "e-1",
					from: "finding:f-1",
					to: "project:p-1",
					kind: "related_to",
					confidence: 1,
					evidenceRefs: [],
				},
				{
					id: "e-2",
					from: "finding:f-1",
					to: "evidence:1",
					kind: "evidenced_by",
					confidence: 1,
					evidenceRefs: ["evidence:1"],
				},
			],
		};

		expect(countGraphKinds(graph)).toEqual({
			nodeCounts: { project: 1, finding: 2 },
			edgeCounts: { related_to: 1, evidenced_by: 1 },
		});
	});
});
