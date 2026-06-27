import { describe, expect, it } from "vitest";
import type {
	DiagnosticReport,
	Finding,
	FindingDecision,
	FindingReview,
	ScanReport,
	ScanRun,
} from "../../api";
import {
	buildActionQueue,
	deriveFindingWorkState,
	sortActionQueue,
	type ActionQueueItem,
} from "./work-states";

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
		decision: "needs_fix",
		reason: "confirmed_by_review",
		comment: null,
		linkedReviewId: null,
		decidedByUserId: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function review(overrides: Partial<FindingReview> = {}): FindingReview {
	return {
		id: "review-1",
		findingId: "finding-1",
		provider: "codex",
		model: "gpt-5",
		status: "completed",
		summary: null,
		likelyImpact: null,
		falsePositiveAssessment: null,
		evidenceStrength: { level: "moderate", reasoning: "Saved evidence exists." },
		remediationDirection: null,
		reviewerNotes: null,
		confidenceAdjustment: "unchanged",
		inputBundle: null,
		output: null,
		errorMessage: null,
		createdByUserId: null,
		startedAt: now,
		completedAt: now,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		id: "finding-1",
		scanRunId: "scan-1",
		projectId: "project-1",
		sourceTool: "semgrep",
		ruleId: "rule-1",
		title: "Unsafe HTML",
		description: "Unsanitized HTML is rendered.",
		severity: "high",
		confidence: "static",
		status: "open",
		primaryLocation: { path: "web/src/app.tsx", startLine: 12 },
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

describe("work states", () => {
	it("failed scan produces high-priority scan item", () => {
		const queue = buildActionQueue({
			scanRuns: [scanRun({ status: "failed" })],
			selectedScanRunId: "scan-1",
			findings: [],
		});

		expect(queue[0]).toMatchObject({
			targetType: "scan",
			state: "scan_failed",
			priority: "high",
		});
	});

	it("finding without evidence location produces blocked_by_evidence", () => {
		expect(
			deriveFindingWorkState({
				finding: finding({ primaryLocation: null, metadata: {} }),
				latestReview: review(),
			}),
		).toBe("blocked_by_evidence");
	});

	it("finding without review produces needs_review", () => {
		expect(deriveFindingWorkState({ finding: finding() })).toBe(
			"needs_review",
		);
	});

	it("finding with review but no decision produces needs_decision", () => {
		expect(
			deriveFindingWorkState({
				finding: finding(),
				latestReview: review(),
			}),
		).toBe("needs_decision");
	});

	it("high severity undecided finding sorts before low severity undecided finding", () => {
		const items: ActionQueueItem[] = [
			{
				id: "low",
				targetType: "finding",
				targetId: "low",
				state: "needs_decision",
				priority: "medium",
				label: "Low",
				reason: "Low severity",
				updatedAt: now,
				severity: "low",
			},
			{
				id: "high",
				targetType: "finding",
				targetId: "high",
				state: "needs_decision",
				priority: "medium",
				label: "High",
				reason: "High severity",
				updatedAt: now,
				severity: "high",
			},
		];

		expect(sortActionQueue(items).map((item) => item.id)).toEqual([
			"high",
			"low",
		]);
	});

	it("zero-finding scan without diagnostic report produces zero_finding_needs_coverage", () => {
		const queue = buildActionQueue({
			scanRuns: [scanRun()],
			selectedScanRunId: "scan-1",
			findings: [],
			diagnosticReports: [],
		});

		expect(queue[0]).toMatchObject({
			targetType: "diagnostic",
			state: "zero_finding_needs_coverage",
			priority: "medium",
		});
	});

	it("zero-finding scan still needs coverage even when a report already exists", () => {
		const queue = buildActionQueue({
			scanRuns: [scanRun()],
			selectedScanRunId: "scan-1",
			findings: [],
			reports: [report()],
			diagnosticReports: [],
		});

		expect(queue[0]).toMatchObject({
			targetType: "diagnostic",
			state: "zero_finding_needs_coverage",
		});
		expect(queue.some((item) => item.state === "report_generated")).toBe(false);
	});

	it("report-generated items are low priority", () => {
		const queue = buildActionQueue({
			scanRuns: [scanRun()],
			selectedScanRunId: "scan-1",
			findings: [
				finding({
					latestDecision: decision(),
					latestReview: review(),
				}),
			],
			reports: [report()],
			diagnosticReports: [diagnosticReport()],
		});

		expect(queue).toContainEqual(
			expect.objectContaining({
				targetType: "report",
				state: "report_generated",
				priority: "low",
			}),
		);
	});
});
