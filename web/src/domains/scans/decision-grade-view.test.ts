import { describe, expect, it } from "vitest";
import type {
	DiagnosticReport,
	Finding,
	ScanReview,
	ScanRun,
} from "../../api";
import type { CoverageSummary } from "./coverage-summary";
import { buildDecisionGradeView } from "./decision-grade-view";
import type { EvidenceQualityView } from "./evidence-quality";
import type { RemediationPlanView } from "./remediation-plan";

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

const scanReview = (overrides: Partial<ScanReview> = {}): ScanReview => ({
	id: "scan-review-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	provider: "codex",
	model: "gpt-5",
	status: "completed",
	summary: null,
	riskOverview: null,
	priorityNotes: [],
	coverageNotes: [],
	falsePositiveHotspots: [],
	recommendedNextActions: [],
	findingTriageHints: [],
	confidenceNotes: [],
	inputBundle: { generationKind: "improvement_request" },
	output: {
		improvementRequest: {
			title: "Fix high risk finding",
			objective: "Fix the stored finding.",
			scope: ["Stored scan bundle only."],
			priorityPlan: [
				{
					priority: "high",
					rationale: "High severity finding.",
					findingIds: ["finding-1"],
				},
			],
			implementationTasks: [
				{
					title: "Patch sink",
					body: "Escape output.",
					findingIds: ["finding-1"],
					evidenceRefs: [],
				},
			],
			acceptanceCriteria: ["Finding is fixed."],
			verificationCommands: ["bun test"],
			constraints: ["Use stored evidence only."],
			nonGoals: ["No new scanner."],
			handoffPrompt: "Use stored evidence to fix finding-1.",
		},
	},
	errorMessage: null,
	createdAt: now,
	startedAt: now,
	completedAt: now,
	updatedAt: now,
	...overrides,
});

const evidence = (findingId = "finding-1"): EvidenceQualityView => ({
	findingId,
	level: "strong",
	dataCompleteness: "complete",
	dataCompletenessLabel: "完全評価",
	score: 90,
	label: "strong",
	reasons: [],
	missingSignals: [],
	presentSignals: [],
	recommendedNextAction: "ready_for_report",
});

const remediation = (findingId = "finding-1"): RemediationPlanView => ({
	findingId,
	status: "planned",
	owner: "security",
	priority: "p1",
	dueDate: null,
	recommendedFix: "Patch sink.",
	verificationRequired: false,
	verificationStatus: "not_run",
	blockingReasons: [],
});

const diagnosticReport = (): DiagnosticReport => ({
	id: "diagnostic-1",
	projectId: "project-1",
	scanRunId: "scan-1",
	reportKind: "zero-finding",
	status: "completed",
	summary: "No findings with coverage context.",
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

const coverageSummary = (
	overrides: Partial<CoverageSummary> = {},
): CoverageSummary => ({
	scanRunId: "scan-1",
	hasFindings: false,
	sourceSast: null,
	toolCoverage: [],
	attackSurfaceCounts: {},
	checkStatusCounts: {},
	coverageGaps: [],
	latestDiagnosticReport: null,
	missingActions: ["generate_diagnostic_report"],
	...overrides,
});

const build = (
	overrides: Partial<Parameters<typeof buildDecisionGradeView>[0]> = {},
) =>
	buildDecisionGradeView({
		selectedScanRunId: "",
		selectedScanRun: null,
		findings: [],
		scanReviews: [],
		evidenceQualityByFindingId: new Map(),
		remediationPlanByFindingId: new Map(),
		reports: [],
		diagnosticReports: [],
		selectedCoverageSummary: coverageSummary({ scanRunId: "" }),
		baselineScanRunId: null,
		baselineFindings: null,
		...overrides,
	});

describe("buildDecisionGradeView", () => {
	it("handles no selected scan without requiring controller state", () => {
		const view = build();
		expect(view.workflowCompletion.stage).toBe("scan_running");
		expect(view.scanComparison.status).toBe("missing_baseline");
		expect(view.hasScanImprovementRequest).toBe(false);
	});

	it("uses a scan-level handoff for undecided findings", () => {
		const item = finding();
		const view = build({
			selectedScanRunId: "scan-1",
			selectedScanRun: scanRun(),
			findings: [item],
			scanReviews: [scanReview()],
			evidenceQualityByFindingId: new Map([[item.id, evidence(item.id)]]),
			remediationPlanByFindingId: new Map([[item.id, remediation(item.id)]]),
			selectedCoverageSummary: coverageSummary({
				scanRunId: "scan-1",
				hasFindings: true,
				missingActions: [],
			}),
		});

		expect(view.hasScanImprovementRequest).toBe(true);
			expect(view.workflowCompletion.stage).not.toBe("needs_handoff");
			expect(view.reportQualityPreview.missingInputs).not.toContain(
				"LLM 実装引き継ぎが不足",
			);
		});

	it("treats a zero-finding scan with coverage context as report-ready", () => {
		const diagnostic = diagnosticReport();
		const view = build({
			selectedScanRunId: "scan-1",
			selectedScanRun: scanRun(),
			diagnosticReports: [diagnostic],
			selectedCoverageSummary: coverageSummary({
				scanRunId: "scan-1",
				latestDiagnosticReport: diagnostic,
				missingActions: [],
			}),
		});

		expect(view.executiveRiskSummary.riskBand).toBe("informational");
		expect(view.workflowCompletion.stage).toBe("report_ready");
		expect(view.reportQualityPreview.readiness).toBe("partial");
	});
});
