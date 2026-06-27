import { describe, expect, it } from "vitest";
import type { DiagnosticReport, Finding } from "../../api";
import type { EvidenceQualityView } from "./evidence-quality";
import type { RemediationPlanView } from "./remediation-plan";
import { buildReportQualityPreview } from "./report-quality";

const now = "2026-06-27T00:00:00.000Z";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
	id: "finding-1",
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
	fingerprint: "fp",
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const decided = (): Finding => ({
	...finding(),
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

const evidence = (level: EvidenceQualityView["level"]): EvidenceQualityView => ({
	findingId: "finding-1",
	level,
	dataCompleteness: "complete",
	dataCompletenessLabel: "完全評価",
	score: 90,
	label: level,
	reasons: [],
	missingSignals: [],
	presentSignals: [],
	recommendedNextAction: "ready_for_report",
});

const remediation = (blockingReasons: string[] = []): RemediationPlanView => ({
	findingId: "finding-1",
	status: "accepted",
	owner: null,
	priority: "p1",
	dueDate: null,
	recommendedFix: null,
	verificationRequired: false,
	verificationStatus: "not_run",
	blockingReasons,
});

const diagnosticReport = (): DiagnosticReport => ({
	id: "diagnostic-1",
	projectId: "project-1",
	scanRunId: "scan-1",
	reportKind: "zero-finding",
	status: "completed",
	summary: "No findings after coverage review.",
	checkedCategoriesJson: [],
	coverageGapsJson: [],
	residualRisksJson: [],
	recommendedNextActionsJson: [],
	artifactId: null,
	metadata: {},
	errorMessage: null,
	createdAt: now,
	updatedAt: now,
});

describe("buildReportQualityPreview", () => {
	it("all required inputs returns ready or partial only for missing baseline", () => {
		const result = buildReportQualityPreview({
			scanRunId: "scan-1",
			findings: [decided()],
			evidenceByFindingId: new Map([["finding-1", evidence("strong")]]),
			remediationByFindingId: new Map([["finding-1", remediation()]]),
			comparison: {
				currentScanRunId: "scan-1",
				baselineScanRunId: "scan-0",
				status: "available",
				counts: { new: 0, resolved: 0, unchanged: 1, regressed: 0 },
				severityTrend: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				deltas: [],
			},
			hasScanImprovementRequest: true,
		});
		expect(result.readiness).toBe("ready");
		expect(result.submissionLevel).toBe("submission_ready");
		expect(result.primaryActionLabel).toBe("提出用レポートを生成");
		expect(result.generationWarning).toBeNull();
		expect(result.sections.find((item) => item.id === "risk-ranking")?.reason).toBeUndefined();
	});

	it("missing LLM implementation handoff returns blocked", () => {
		const result = buildReportQualityPreview({
			scanRunId: "scan-1",
			findings: [finding()],
		});
		expect(result.readiness).toBe("blocked");
		expect(result.submissionLevel).toBe("incomplete");
			expect(
				result.missingInputs.some((item) => item.includes("実装引き継ぎ")),
			).toBe(true);
		expect(result.generationWarning).toBeNull();
	});

	it("scan improvement handoff clears the handoff blocker", () => {
		const result = buildReportQualityPreview({
			scanRunId: "scan-1",
			findings: [finding()],
			evidenceByFindingId: new Map([["finding-1", evidence("strong")]]),
			remediationByFindingId: new Map([["finding-1", remediation()]]),
			hasScanImprovementRequest: true,
		});
		expect(result.readiness).toBe("partial");
		expect(result.submissionLevel).toBe("internal_review");
		expect(result.primaryActionLabel).toBe("内部レビュー用ドラフトを生成");
		expect(result.generationWarning).toBeNull();
			expect(
				result.missingInputs.some((item) => item.includes("実装引き継ぎ")),
			).toBe(false);
		expect(
			result.sections.find((item) => item.id === "finding-decisions"),
		).toMatchObject({
			status: "ready",
		});
	});

	it("missing remediation for high finding blocks readiness", () => {
		const result = buildReportQualityPreview({
			scanRunId: "scan-1",
			findings: [decided()],
			evidenceByFindingId: new Map([["finding-1", evidence("strong")]]),
			remediationByFindingId: new Map([["finding-1", remediation(["owner_required"])]]),
		});
		expect(result.readiness).toBe("blocked");
		expect(result.generationWarning).toBeNull();
	});

	it("missing baseline comparison only marks comparison section partial", () => {
		const result = buildReportQualityPreview({
			scanRunId: "scan-1",
			findings: [decided()],
			evidenceByFindingId: new Map([["finding-1", evidence("strong")]]),
			remediationByFindingId: new Map([["finding-1", remediation()]]),
			comparison: {
				currentScanRunId: "scan-1",
				baselineScanRunId: null,
				status: "missing_baseline",
				counts: { new: 0, resolved: 0, unchanged: 0, regressed: 0 },
				severityTrend: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				deltas: [],
			},
			hasScanImprovementRequest: true,
		});
		expect(result.readiness).toBe("partial");
		expect(result.secondaryStatusLabel).toBe("内部レビュー用ドラフト");
		expect(result.sections.find((item) => item.id === "scan-comparison")?.status).toBe("partial");
	});

	it("zero-finding report requires coverage explanation", () => {
		const result = buildReportQualityPreview({
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
		expect(result.readiness).toBe("blocked");
			expect(result.missingInputs).toContain(
				"finding 0 件のカバレッジ説明が不足",
			);
	});

	it("zero-finding report with coverage explanation can be ready", () => {
		const result = buildReportQualityPreview({
			scanRunId: "scan-1",
			findings: [],
			coverageSummary: {
				scanRunId: "scan-1",
				hasFindings: false,
				toolCoverage: [],
				attackSurfaceCounts: {},
				checkStatusCounts: {},
				coverageGaps: [],
				latestDiagnosticReport: diagnosticReport(),
				missingActions: [],
			},
			comparison: {
				currentScanRunId: "scan-1",
				baselineScanRunId: "scan-0",
				status: "available",
				counts: { new: 0, resolved: 0, unchanged: 0, regressed: 0 },
				severityTrend: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				deltas: [],
			},
		});
		expect(result.readiness).toBe("ready");
		expect(result.sections.find((item) => item.id === "risk-ranking")?.status).toBe("ready");
		expect(result.sections.find((item) => item.id === "zero-finding-coverage")?.status).toBe("ready");
	});
});
