import { describe, expect, it } from "vitest";
import type {
	AttackSurfaceItem,
	DiagnosticReport,
	Finding,
	FindingDecision,
	ScanReport,
	ScanReview,
	ScanRun,
	SecurityCheckResult,
} from "../../api";
import { buildProjectDiagnosticDashboard } from "./diagnostic-dashboard";

type TestFinding = Finding & { latestReview?: unknown | null };

const now = "2026-06-27T00:00:00.000Z";

function scanRun(overrides: Partial<ScanRun> = {}): ScanRun {
	return {
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
	};
}

function decision(
	overrides: Partial<FindingDecision> = {},
): FindingDecision {
	return {
		id: "decision-1",
		findingId: "finding-1",
		decision: "accepted",
		reason: "confirmed_by_evidence",
		comment: null,
		linkedReviewId: null,
		decidedByUserId: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function finding(overrides: Partial<TestFinding> = {}): TestFinding {
	return {
		id: "finding-1",
		scanRunId: "scan-1",
		projectId: "project-1",
		sourceTool: "semgrep",
		ruleId: "rule-1",
		title: "Finding",
		description: "Finding description",
		severity: "high",
		confidence: "static",
		status: "open",
		primaryLocation: null,
		fingerprint: "fingerprint-1",
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function report(overrides: Partial<ScanReport> = {}): ScanReport {
	return {
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
		...overrides,
	};
}

function diagnosticReport(
	overrides: Partial<DiagnosticReport> = {},
): DiagnosticReport {
	return {
		id: "diagnostic-report-1",
		projectId: "project-1",
		scanRunId: "scan-1",
		reportKind: "zero-finding",
		status: "completed",
		summary: null,
		checkedCategoriesJson: [],
		coverageGapsJson: [],
		residualRisksJson: [],
		recommendedNextActionsJson: [],
		artifactId: null,
		metadata: {},
		errorMessage: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function securityCheck(
	overrides: Partial<SecurityCheckResult> = {},
): SecurityCheckResult {
	return {
		id: "security-check-1",
		projectId: "project-1",
		scanRunId: "scan-1",
		checkId: "check-1",
		attackSurfaceItemId: null,
		status: "pass",
		outcome: null,
		title: "Check",
		summary: "Summary",
		evidenceRefsJson: [],
		remediationHint: null,
		coverageGap: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function attackSurfaceItem(
	overrides: Partial<AttackSurfaceItem> = {},
): AttackSurfaceItem {
	return {
		id: "attack-surface-1",
		projectId: "project-1",
		scanRunId: "scan-1",
		category: "service",
		name: "App",
		kind: "http",
		locationJson: {},
		boundaryJson: {},
		evidenceRefsJson: [],
		confidence: "high",
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function scanReview(overrides: Partial<ScanReview> = {}): ScanReview {
	return {
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
		output: {},
		errorMessage: null,
		createdAt: now,
		startedAt: now,
		completedAt: now,
		updatedAt: now,
		...overrides,
	};
}

function scanReviewWithImprovementRequest(
	overrides: Partial<ScanReview> = {},
): ScanReview {
	return scanReview({
		output: {
			improvementRequest: {
				title: "Fix high risk finding",
				objective: "Pass stored scan risk to the next LLM.",
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
						title: "Reduce implementation risk",
						body: "Use stored evidence to patch the risky code path.",
						findingIds: ["finding-1"],
						evidenceRefs: [],
					},
				],
				acceptanceCriteria: ["Risk is reduced in implementation."],
				verificationCommands: ["bun test"],
				constraints: ["Use stored evidence only."],
				nonGoals: ["No new scanner."],
				handoffPrompt: "Use stored evidence to reduce implementation risk.",
			},
		},
		...overrides,
	});
}

function build(
	overrides: Partial<Parameters<typeof buildProjectDiagnosticDashboard>[0]> = {},
) {
	return buildProjectDiagnosticDashboard({
		projectId: "project-1",
		scanRuns: [scanRun()],
		selectedScanRunId: "scan-1",
		findings: [],
		reports: [],
		scanReviews: [],
		diagnosticReports: [],
		securityCheckResults: [],
		attackSurfaceItems: [],
		...overrides,
	});
}

describe("buildProjectDiagnosticDashboard", () => {
	it("returns run_scan when there is no project and no scan", () => {
		const dashboard = build({
			projectId: "",
			scanRuns: [],
			selectedScanRunId: "",
		});

		expect(dashboard.latestScanRun).toBeNull();
		expect(dashboard.reportReadiness.blockers).toContain("no_scan_selected");
		expect(dashboard.nextActions[0]).toMatchObject({
			kind: "run_scan",
			priority: "high",
		});
	});

	it("returns high-priority run_scan for a failed latest scan", () => {
		const dashboard = build({
			scanRuns: [scanRun({ status: "failed", completedAt: now })],
		});

		expect(dashboard.latestScanRun?.status).toBe("failed");
		expect(dashboard.nextActions[0]).toMatchObject({
			kind: "run_scan",
			priority: "high",
			targetId: "scan-1",
		});
	});

	it("returns create_improvement_request for completed scans with undecided findings", () => {
		const dashboard = build({
			findings: [finding({ id: "finding-undecided" })],
			securityCheckResults: [securityCheck()],
			attackSurfaceItems: [attackSurfaceItem()],
		});

		expect(dashboard.decisionProgress.undecidedFindings).toBe(1);
		expect(dashboard.nextActions[0]).toMatchObject({
			kind: "create_improvement_request",
			priority: "high",
			targetId: "scan-1",
		});
	});

	it("ignores improvement requests from other scan runs", () => {
		const dashboard = build({
			findings: [finding({ id: "finding-undecided" })],
			scanReviews: [
				scanReview({
					scanRunId: "scan-other",
					output: {
						improvementRequest: {
							handoffPrompt: "別 scan の改善依頼書",
						},
					},
				}),
			],
			securityCheckResults: [securityCheck()],
			attackSurfaceItems: [attackSurfaceItem()],
		});

		expect(dashboard.reportReadiness.blockers).toContain(
			"missing_improvement_request",
		);
		expect(dashboard.nextActions[0]).toMatchObject({
			kind: "create_improvement_request",
			targetId: "scan-1",
		});
	});

	it("returns inspect_zero_findings for zero-finding scans without a diagnostic report", () => {
		const dashboard = build({
			findings: [],
			securityCheckResults: [securityCheck()],
			attackSurfaceItems: [attackSurfaceItem()],
		});

		expect(dashboard.reportReadiness.blockers).toContain(
			"missing_diagnostic_summary_for_zero_findings",
		);
		expect(dashboard.nextActions[0]).toMatchObject({
			kind: "inspect_zero_findings",
			priority: "high",
		});
	});

	it("returns generate_report when an implementation handoff exists and no report exists", () => {
		const dashboard = build({
			findings: [
				finding({
					latestDecision: decision(),
					latestReview: { id: "review-1" },
				}),
			],
			scanReviews: [scanReviewWithImprovementRequest()],
			diagnosticReports: [diagnosticReport()],
			securityCheckResults: [securityCheck()],
			attackSurfaceItems: [attackSurfaceItem()],
		});

		expect(dashboard.reportReadiness.ready).toBe(true);
		expect(dashboard.reportReadiness.scanReports).toBe(0);
		expect(dashboard.nextActions.map((action) => action.kind)).toContain(
			"generate_report",
		);
	});

	it("counts severity only for the active scan run", () => {
		const dashboard = build({
			scanRuns: [
				scanRun({ id: "scan-2", createdAt: "2026-06-27T01:00:00.000Z" }),
				scanRun({ id: "scan-1", createdAt: now }),
			],
			selectedScanRunId: "scan-1",
			findings: [
				finding({ id: "active-medium", scanRunId: "scan-1", severity: "medium" }),
				finding({ id: "other-critical", scanRunId: "scan-2", severity: "critical" }),
			],
			reports: [report()],
		});

		expect(dashboard.severityCounts.medium).toBe(1);
		expect(dashboard.severityCounts.critical).toBe(0);
		expect(dashboard.latestScanRun?.id).toBe("scan-2");
		expect(dashboard.latestScanRun?.findingCount).toBe(1);
		expect(dashboard.latestScanRun?.findingCountKnown).toBe(true);
	});

	it("marks latest finding count unknown when only an older selected scan is loaded", () => {
		const dashboard = build({
			scanRuns: [
				scanRun({ id: "scan-2", createdAt: "2026-06-27T01:00:00.000Z" }),
				scanRun({ id: "scan-1", createdAt: now }),
			],
			selectedScanRunId: "scan-1",
			findings: [
				finding({ id: "active-medium", scanRunId: "scan-1", severity: "medium" }),
			],
			reports: [report()],
		});

		expect(dashboard.latestScanRun?.id).toBe("scan-2");
		expect(dashboard.latestScanRun?.findingCount).toBe(0);
		expect(dashboard.latestScanRun?.findingCountKnown).toBe(false);
	});
});
