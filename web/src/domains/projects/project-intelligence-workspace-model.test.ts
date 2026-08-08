import { describe, expect, it } from "vitest";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { Finding } from "../../api";
import {
	buildGuidedQueue,
	buildGuidedVisibleQueue,
	buildPriorityPresentation,
	buildRiskMatrix,
	countGuidedProgress,
} from "./project-intelligence-workspace-model";

const finding = (
	id: string,
	severity: Finding["severity"],
	path: string,
	decided = false,
): Finding => ({
	id,
	scanRunId: "scan-1",
	projectId: "project-1",
	sourceTool: "semgrep",
	ruleId: `rule-${id}`,
	title: id,
	description: id,
	severity,
	confidence: "static",
	status: "open",
	primaryLocation: { path, startLine: 1 },
	fingerprint: id,
	metadata: {},
	createdAt: "2026-08-08T00:00:00.000Z",
	updatedAt: "2026-08-08T00:00:00.000Z",
	latestDecision: decided
		? ({ decision: "needs_fix" } as Finding["latestDecision"])
		: null,
});

const exportPayload = {
	fileRiskIndex: [
		{
			path: "src/app.ts",
			findingCount: 2,
			maxSeverity: "critical",
			findingIds: ["finding-critical", "finding-high"],
			evidenceQuality: "strong",
			scanners: ["semgrep"],
			ruleIds: [],
			evidenceRefs: [],
			artifactRefs: [],
			verificationRefs: [],
			latestScanRunId: "scan-1",
		},
	],
	graph: {
		nodes: [
			{
				id: "node-critical",
				kind: "finding",
				label: "critical",
				sourceId: "finding-critical",
				severity: "critical",
			},
			{
				id: "node-high",
				kind: "finding",
				label: "high",
				sourceId: "finding-high",
				severity: "high",
			},
		],
		edges: [],
	},
	scan: { findingCount: 2 },
	scanSummary: { riskBand: "critical", evidenceQuality: "strong" },
} as unknown as StaticIntelligenceExportV1;

describe("project Intelligence workspace models", () => {
	it("builds a stable priority presentation", () => {
		const result = buildPriorityPresentation(exportPayload, []);
		expect(result.tone).toBe("danger");
		expect(result.highRiskFindingCount).toBe(2);
		expect(result.topFiles[0]?.path).toBe("src/app.ts");
	});

	it("keeps high-risk urgency primary when the generation is degraded", () => {
		const result = buildPriorityPresentation(exportPayload, ["partial_export"]);
		expect(result.tone).toBe("danger");
		expect(result.description).toContain("Critical / High");
		expect(result.description).toContain("1件の生成上の制約");
	});

	it("deduplicates high-risk ids when graph severity is unavailable", () => {
		const payload = {
			...exportPayload,
			graph: { nodes: [], edges: [] },
			fileRiskIndex: [
				...exportPayload.fileRiskIndex,
				{
					...exportPayload.fileRiskIndex[0],
					path: "src/duplicate.ts",
				},
			],
		} as StaticIntelligenceExportV1;
		expect(buildPriorityPresentation(payload, []).highRiskFindingCount).toBe(2);
	});

	it("deduplicates module finding ids in the risk matrix", () => {
		const rows = buildRiskMatrix(
			[
				{
					id: "module-app",
					label: "App",
					pathPrefix: "src",
					risk: {
						findingIds: ["finding-critical", "finding-critical", "missing"],
						fileRefs: ["src/app.ts"],
						maxSeverity: "critical",
					},
				} as never,
			],
			exportPayload,
		);
		expect(rows[0]?.total).toBe(2);
		expect(rows[0]?.counts.critical).toBe(1);
		expect(rows[0]?.counts.unknown).toBe(1);
	});

	it("places undecided findings first and reports progress", () => {
		const findings = [
			finding("decided", "critical", "a.ts", true),
			finding("low", "low", "b.ts"),
			finding("high", "high", "c.ts"),
		];
		expect(buildGuidedQueue(findings).map((item) => item.id)).toEqual([
			"high",
			"low",
			"decided",
		]);
		expect(countGuidedProgress(findings)).toEqual({
			completed: 1,
			total: 3,
			remaining: 2,
		});
	});

	it("keeps the just-decided finding selected until the user advances", () => {
		const findings = [
			finding("selected", "critical", "a.ts", true),
			finding("next", "high", "b.ts"),
		];
		expect(
			buildGuidedVisibleQueue(findings, {
				scope: "undecided",
				severity: "all",
				pinnedFindingId: "selected",
			}).map((item) => item.id),
		).toEqual(["selected", "next"]);
		expect(
			buildGuidedVisibleQueue(findings, {
				scope: "undecided",
				severity: "all",
				pinnedFindingId: null,
			}).map((item) => item.id),
		).toEqual(["next"]);
	});
});
