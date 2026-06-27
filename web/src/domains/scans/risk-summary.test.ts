import { describe, expect, it } from "vitest";
import type { Finding } from "../../api";
import type { EvidenceQualityView } from "./evidence-quality";
import { buildExecutiveRiskSummary } from "./risk-summary";

const now = "2026-06-27T00:00:00.000Z";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
	id: overrides.id ?? "finding-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	sourceTool: "semgrep",
	ruleId: "rule",
	title: "Risk",
	description: "risk",
	severity: "high",
	confidence: "static",
	status: "open",
	primaryLocation: { path: "src/app.ts" },
	fingerprint: overrides.id ?? "fp",
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const evidence = (level: EvidenceQualityView["level"]): EvidenceQualityView => ({
	findingId: "finding-1",
	level,
	score: level === "strong" ? 90 : 40,
	label: level,
	reasons: [],
	missingSignals: [],
	presentSignals: [],
	recommendedNextAction: "ready_for_report",
});

describe("buildExecutiveRiskSummary", () => {
	it("critical strong-evidence finding produces critical risk band", () => {
		const item = finding({ severity: "critical" });
		const result = buildExecutiveRiskSummary({
			scanRunId: "scan-1",
			findings: [item],
			evidenceByFindingId: new Map([[item.id, evidence("strong")]]),
		});
		expect(result.riskBand).toBe("critical");
	});

	it("false positive does not drive risk band", () => {
		const item = finding({
			severity: "critical",
			latestDecision: {
				id: "d1",
				findingId: "finding-1",
				decision: "false_positive",
				reason: "tool_noise",
				comment: null,
				linkedReviewId: null,
				decidedByUserId: null,
				createdAt: now,
				updatedAt: now,
			},
		});
		const result = buildExecutiveRiskSummary({ scanRunId: "scan-1", findings: [item] });
		expect(result.riskBand).toBe("informational");
		expect(result.counts.falsePositive).toBe(1);
	});

	it("accepted risk remains visible in counts", () => {
		const item = finding({
			latestDecision: {
				id: "d1",
				findingId: "finding-1",
				decision: "accepted",
				reason: "accepted_risk",
				comment: null,
				linkedReviewId: null,
				decidedByUserId: null,
				createdAt: now,
				updatedAt: now,
			},
		});
		const result = buildExecutiveRiskSummary({ scanRunId: "scan-1", findings: [item] });
		expect(result.counts.acceptedRisk).toBe(1);
		expect(result.recommendedFocus[0]?.reason).toContain("Accepted exposure");
	});

	it("weak evidence reduces confidence but does not remove finding", () => {
		const item = finding({ severity: "high" });
		const result = buildExecutiveRiskSummary({
			scanRunId: "scan-1",
			findings: [item],
			evidenceByFindingId: new Map([[item.id, evidence("weak")]]),
		});
		expect(result.counts.weakOrMissingEvidence).toBe(1);
		expect(result.recommendedFocus[0]?.findingId).toBe(item.id);
	});

	it("zero findings produce low or informational band with coverage note", () => {
		const result = buildExecutiveRiskSummary({
			scanRunId: "scan-1",
			findings: [],
			coverageSummary: {
				scanRunId: "scan-1",
				hasFindings: false,
				toolCoverage: [],
				attackSurfaceCounts: {},
				checkStatusCounts: {},
				coverageGaps: [],
				latestDiagnosticReport: null,
				missingActions: ["generate_diagnostic_report"],
			},
		});
		expect(result.riskBand).toBe("low");
		expect(result.headline).toContain("coverage");
	});
});
