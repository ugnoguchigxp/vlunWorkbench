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
	type ActionQueueItem,
	buildActionQueue,
	deriveFindingWorkState,
	deriveScanWorkState,
	sortActionQueue,
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

	it("finding without review is reportable when scanner evidence exists", () => {
		expect(deriveFindingWorkState({ finding: finding() })).toBe(
			"ready_for_report",
		);
	});

	it("finding with review but no decision is ready for report", () => {
		expect(
			deriveFindingWorkState({
				finding: finding(),
				latestReview: review(),
			}),
		).toBe("ready_for_report");
	});

	it("high severity review item sorts before low severity review item", () => {
		const items: ActionQueueItem[] = [
			{
				id: "low",
				targetType: "finding",
				targetId: "low",
				state: "needs_review",
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
				state: "needs_review",
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

	it("a completed report finishes a zero-finding scan without human review", () => {
		const queue = buildActionQueue({
			scanRuns: [scanRun()],
			selectedScanRunId: "scan-1",
			findings: [],
			reports: [report()],
			diagnosticReports: [],
		});

		expect(queue[0]).toMatchObject({
			targetType: "report",
			state: "report_generated",
		});
		expect(queue.some((item) => item.state === "report_generated")).toBe(true);
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

	it("completed verification clears needs_verification queue item", () => {
		const findingWithWeakReview = finding({
			latestDecision: decision(),
			latestReview: review({
				evidenceStrength: { level: "weak", reasoning: "Needs proof." },
			}),
		});
		const queue = buildActionQueue({
			scanRuns: [scanRun()],
			selectedScanRunId: "scan-1",
			findings: [findingWithWeakReview],
			verificationByFindingId: new Map([
				[
					findingWithWeakReview.id,
					{
						reproductionRuns: [
							{
								id: "repro-1",
								findingId: findingWithWeakReview.id,
									scanRunId: "scan-1",
									projectId: "project-1",
									profileId: "default",
									status: "completed",
									outcome: "not_reproduced",
									runner: "local",
									commandJson: null,
									exitCode: 0,
									startedAt: now,
									completedAt: now,
									summary: null,
								errorMessage: null,
								metadata: {},
								createdByUserId: null,
								createdAt: now,
								updatedAt: now,
							},
						],
					},
				],
			]),
		});

		expect(queue.some((item) => item.state === "needs_verification")).toBe(
			false,
		);
	});

	it("records explicit false-positive and accepted-risk decisions", () => {
		expect(
			deriveFindingWorkState({
				finding: finding({ latestDecision: decision({ decision: "false_positive" }) }),
			}),
		).toBe("false_positive_recorded");
		expect(
			deriveFindingWorkState({
				finding: finding({ latestDecision: decision({ decision: "accepted" }) }),
			}),
		).toBe("accepted_risk_recorded");
	});

	it("requires verification for weak review and clears it after dynamic completion", () => {
		const weak = finding({
			latestReview: review({
				evidenceStrength: { level: "weak", reasoning: "Weak" },
			}),
		});
		expect(deriveFindingWorkState({ finding: weak })).toBe("needs_verification");
		expect(
			deriveFindingWorkState({
				finding: weak,
				dynamicRuns: [
					{
						status: "completed",
						outcome: "failed",
					} as never,
				],
			}),
		).toBe("ready_for_report");
	});

	it("accepts evidence from artifacts, snippets, and metadata", () => {
		for (const input of [
			{ evidence: [{ artifactId: "artifact-1" }] },
			{ evidence: [{ location: { path: "src/app.ts" } }] },
			{ evidence: [{ snippet: "const value = 1" }] },
			{ finding: finding({ metadata: { evidenceRefs: ["ref-1"] } }) },
		]) {
			expect(
				deriveFindingWorkState({
					finding: input.finding ?? finding({ primaryLocation: null }),
					evidence: input.evidence as never,
					latestReview: review(),
				}),
			).toBe("ready_for_report");
		}
	});

	it("derives scan states for cancelled, diagnostic, ready, and triage scans", () => {
		const base = { scanRun: scanRun(), findings: [] };
		expect(deriveScanWorkState({ ...base, scanRun: scanRun({ status: "cancelled" }) })).toBe(
			"scan_failed",
		);
		expect(
			deriveScanWorkState({ ...base, diagnosticReports: [diagnosticReport()] }),
		).toBe("report_ready");
		expect(
			deriveScanWorkState({
				...base,
				findings: [finding({ latestDecision: decision(), latestReview: review() })],
				reports: [report()],
			}),
		).toBe("report_generated");
		expect(
			deriveScanWorkState({
				...base,
				findings: [finding()],
			}),
		).toBe("report_ready");
	});

	it("builds report-ready items and includes cancelled scans", () => {
		const queue = buildActionQueue({
			scanRuns: [scanRun({ status: "cancelled" })],
			selectedScanRunId: "scan-1",
			findings: [],
		});
		expect(queue).toContainEqual(expect.objectContaining({ state: "scan_failed" }));

		const ready = buildActionQueue({
			scanRuns: [scanRun()],
			selectedScanRunId: "scan-1",
			findings: [finding({ latestDecision: decision(), latestReview: review() })],
			diagnosticReports: [diagnosticReport()],
		});
		expect(ready).toContainEqual(expect.objectContaining({ state: "ready_for_report" }));
	});
});
