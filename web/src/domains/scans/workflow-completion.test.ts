import { describe, expect, it } from "vitest";
import type { Finding, ScanReport, ScanRun } from "../../api";
import type { EvidenceQualityView } from "./evidence-quality";
import { buildWorkflowCompletion } from "./workflow-completion";

const now = "2026-06-27T00:00:00.000Z";

const scanRun = (overrides: Partial<ScanRun> = {}): ScanRun => ({
	id: "scan-1",
	projectId: "project-1",
	profile: "baseline",
	status: "completed",
	startedAt: now,
	completedAt: now,
	createdByUserId: null,
	summary: null,
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

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

const evidence = (level: EvidenceQualityView["level"]): EvidenceQualityView => ({
	findingId: "finding-1",
	level,
	dataCompleteness: "complete",
	dataCompletenessLabel: "完全評価",
	score: 80,
	label: level,
	reasons: [],
	missingSignals: [],
	presentSignals: [],
	recommendedNextAction: "ready_for_report",
});

const report = (): ScanReport => ({
	id: "report-1",
	scanRunId: "scan-1",
	artifactId: null,
	format: "markdown",
	title: "Report",
	summary: null,
	options: {
		includeFalsePositives: true,
		includeDeferred: true,
		includeUndecided: true,
	},
	status: "completed",
	errorMessage: null,
	generatedByUserId: null,
	createdAt: now,
	updatedAt: now,
});

describe("buildWorkflowCompletion", () => {
	it("no LLM reviews returns needs_review with LLM action copy", () => {
		const result = buildWorkflowCompletion({ scanRun: scanRun(), findings: [finding()] });
		expect(result.stage).toBe("needs_review");
		expect(result.nextBestAction).toMatchObject({
			action: "review_findings",
		});
		expect(result.nextBestAction?.label).toContain("LLM");
	});

	it("completed reviews without handoff returns needs_handoff", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun(),
			findings: [finding({ latestReview: { status: "completed" } })],
		});
		expect(result.stage).toBe("needs_handoff");
		expect(result.nextBestAction).toMatchObject({
			action: "create_improvement_request",
			label: "改善依頼を生成",
		});
			expect(result.checklist.find((entry) => entry.id === "handoff")).toMatchObject({
				status: "incomplete",
				label: "LLM 修正依頼",
				count: "不足",
			});
		});

	it("scan improvement handoff is the next gate instead of legacy decisions", () => {
		const item = finding({ latestReview: { status: "completed" } });
		const result = buildWorkflowCompletion({
			scanRun: scanRun(),
			findings: [item],
			evidenceByFindingId: new Map([[item.id, evidence("strong")]]),
			hasScanImprovementRequest: true,
		});
			expect(result.stage).toBe("report_ready");
			expect(result.checklist.find((entry) => entry.id === "handoff")).toMatchObject({
				status: "complete",
				label: "LLM 修正依頼",
			});
		});

	it("weak evidence returns needs_verification after handoff exists", () => {
		const item = finding({
			latestReview: { status: "completed" },
			latestDecision: {
				id: "d1",
				findingId: "finding-1",
				decision: "needs_fix",
				reason: "confirmed_by_evidence",
				comment: null,
				linkedReviewId: null,
				decidedByUserId: null,
				createdAt: now,
				updatedAt: now,
			},
		});
		const result = buildWorkflowCompletion({
			scanRun: scanRun(),
			findings: [item],
			evidenceByFindingId: new Map([[item.id, evidence("weak")]]),
			hasScanImprovementRequest: true,
		});
		expect(result.stage).toBe("needs_verification");
	});

	it("decisions without scan handoff still need LLM handoff", () => {
		const item = finding({
			latestReview: { status: "completed" },
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
		const result = buildWorkflowCompletion({
			scanRun: scanRun(),
			findings: [item],
			evidenceByFindingId: new Map([[item.id, evidence("strong")]]),
		});
		expect(result.stage).toBe("needs_handoff");
		expect(result.nextBestAction?.action).toBe("create_improvement_request");
	});

	it("handoff and verification complete returns report_ready", () => {
		const item = finding({ latestReview: { status: "completed" } });
		const result = buildWorkflowCompletion({
			scanRun: scanRun(),
			findings: [item],
			evidenceByFindingId: new Map([[item.id, evidence("strong")]]),
			hasScanImprovementRequest: true,
		});
		expect(result.stage).toBe("report_ready");
	});

	it("completed report returns report_generated", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun(),
			findings: [],
			reports: [report()],
			coverageSummary: {
				scanRunId: "scan-1",
				hasFindings: false,
				toolCoverage: [],
				attackSurfaceCounts: {},
				checkStatusCounts: {},
				coverageGaps: [],
				latestDiagnosticReport: null,
				missingActions: [],
			},
		});
		expect(result.stage).toBe("report_generated");
	});

	it("zero finding with missing diagnostics returns inspect_coverage", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun(),
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
		expect(result.nextBestAction?.action).toBe("inspect_coverage");
	});
});
