import { describe, expect, it } from "vitest";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { Finding } from "../../api";
import {
	buildFindingIndex,
	buildGuidedQueue,
	buildGuidedVisibleQueue,
	buildPriorityPresentation,
	buildRiskMatrix,
	compareFindings,
	countGuidedProgress,
	formatFindingLocation,
	getFindingPath,
	normalizeIntelligenceSeverity,
	sortFileRiskEntries,
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

	it("covers warning, success, and count-only priority fallbacks", () => {
		const countOnly = {
			...exportPayload,
			graph: { nodes: [{ id: "file", kind: "file", label: "file" }], edges: [] },
			fileRiskIndex: [
				{
					...exportPayload.fileRiskIndex[0],
					findingIds: [],
					findingCount: 3,
				},
				{
					...exportPayload.fileRiskIndex[0],
					path: "src/low.ts",
					findingIds: [],
					findingCount: 4,
					maxSeverity: "low",
				},
			],
		} as StaticIntelligenceExportV1;
		expect(buildPriorityPresentation(countOnly, []).highRiskFindingCount).toBe(3);

		const clean = {
			...countOnly,
			fileRiskIndex: countOnly.fileRiskIndex.map((entry) => ({
				...entry,
				maxSeverity: "low" as const,
			})),
		} as StaticIntelligenceExportV1;
		expect(buildPriorityPresentation(clean, ["partial"]).tone).toBe("warning");
		expect(buildPriorityPresentation(clean, []).tone).toBe("success");
	});

	it("normalizes, sorts, and formats finding locations defensively", () => {
		expect(normalizeIntelligenceSeverity("high")).toBe("high");
		expect(normalizeIntelligenceSeverity("urgent")).toBe("unknown");
		expect(normalizeIntelligenceSeverity(null)).toBe("unknown");

		const noLocation = { ...finding("none", "low", "x"), primaryLocation: null };
		const blankPath = {
			...finding("blank", "low", "x"),
			primaryLocation: { path: "   " },
		};
		const stringLine = {
			...finding("string-line", "low", "b.ts"),
			primaryLocation: { path: "b.ts", startLine: "9" },
		};
		expect(getFindingPath(noLocation)).toBeNull();
		expect(getFindingPath(blankPath)).toBeNull();
		expect(formatFindingLocation(noLocation)).toBe("場所不明");
		expect(formatFindingLocation(stringLine)).toBe("b.ts:9");
		expect(formatFindingLocation(finding("number", "low", "a.ts"))).toBe(
			"a.ts:1",
		);

		const ordered = sortFileRiskEntries([
			{ ...exportPayload.fileRiskIndex[0], path: "z.ts", findingCount: 1 },
			{ ...exportPayload.fileRiskIndex[0], path: "b.ts", findingCount: 2 },
			{ ...exportPayload.fileRiskIndex[0], path: "a.ts", findingCount: 2 },
			{
				...exportPayload.fileRiskIndex[0],
				path: "low.ts",
				maxSeverity: "low",
			},
		]);
		expect(ordered.map((entry) => entry.path)).toEqual([
			"a.ts",
			"b.ts",
			"z.ts",
			"low.ts",
		]);
	});

	it("indexes findings by path and applies stable tie breakers", () => {
		const items = [
			finding("b", "high", "same.ts"),
			finding("a", "high", "same.ts"),
			{ ...finding("none", "low", "x"), primaryLocation: null },
		];
		const index = buildFindingIndex(items);
		expect(index.byId.size).toBe(3);
		expect(index.byPath.get("same.ts")?.map((item) => item.id)).toEqual([
			"a",
			"b",
		]);
		expect(compareFindings(items[0], items[1])).toBeGreaterThan(0);
		expect(compareFindings(items[2], items[0])).toBeGreaterThan(0);
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

	it("builds approximate matrix rows when modules are unavailable", () => {
		const payload = {
			...exportPayload,
			fileRiskIndex: [
				{
					...exportPayload.fileRiskIndex[0],
					path: "src/count-only.ts",
					findingIds: [],
					findingCount: 4,
				},
				{
					...exportPayload.fileRiskIndex[0],
					path: "src/by-id.ts",
					findingIds: ["finding-high", "missing"],
				},
			],
		} as StaticIntelligenceExportV1;
		const rows = buildRiskMatrix([], payload);
		expect(rows[0]).toMatchObject({
			id: "src/count-only.ts",
			label: "count-only.ts",
			total: 4,
			approximate: true,
		});
		expect(rows[0]?.counts.critical).toBe(4);
		expect(rows[1]?.counts.high).toBe(1);
		expect(rows[1]?.counts.unknown).toBe(1);
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

	it("filters guided queues by scope and severity without pinning undecided items", () => {
		const findings = [
			finding("critical", "critical", "a.ts"),
			finding("decided", "high", "b.ts", true),
			finding("low", "low", "c.ts"),
		];
		expect(
			buildGuidedVisibleQueue(findings, {
				scope: "all",
				severity: "high",
				pinnedFindingId: "decided",
			}).map((item) => item.id),
		).toEqual(["decided"]);
		expect(
			buildGuidedVisibleQueue(findings, {
				scope: "undecided",
				severity: "all",
				pinnedFindingId: "critical",
			}).map((item) => item.id),
		).toEqual(["critical", "low"]);
		expect(
			buildGuidedVisibleQueue(findings, {
				scope: "undecided",
				severity: "medium",
				pinnedFindingId: "missing",
			}),
		).toEqual([]);
	});
});
