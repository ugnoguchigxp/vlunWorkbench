import { describe, expect, it } from "vitest";
import type {
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingReview,
} from "../../api";
import {
	buildDecisionWorkflow,
	buildEvidenceChecklist,
	mapDecisionToReportBucket,
} from "./decision-workflow";

const now = "2026-06-27T00:00:00.000Z";
const defaultReportOptions = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};

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

function evidence(overrides: Partial<FindingEvidence> = {}): FindingEvidence {
	return {
		id: "evidence-1",
		findingId: "finding-1",
		kind: "tool-output",
		title: "Semgrep output",
		artifactId: null,
		location: null,
		snippet: null,
		metadata: {},
		createdAt: now,
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
		reason: "confirmed_by_evidence",
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
		evidenceStrength: { level: "moderate", reasoning: "Evidence exists." },
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

describe("decision workflow", () => {
	it("maps no decision to the undecided report bucket", () => {
		expect(mapDecisionToReportBucket(null, defaultReportOptions)).toMatchObject({
			bucket: "undecided",
			includedByDefault: true,
		});
	});

	it("maps false_positive to the false positive report bucket", () => {
		expect(
			mapDecisionToReportBucket(
				decision({ decision: "false_positive" }),
				defaultReportOptions,
			),
		).toMatchObject({
			bucket: "false_positive",
			label: "ツールノイズ記録",
		});
	});

	it("returns needs_context when source and evidence are missing", () => {
		const workflow = buildDecisionWorkflow({
			finding: finding({ primaryLocation: null }),
			evidence: [],
			latestDecision: null,
			latestReview: null,
			reportOptions: defaultReportOptions,
		});

		expect(workflow.decisionState).toBe("needs_context");
		expect(workflow.missingInputs).toContain("主な証跡");
	});

	it("adds a review checklist item when the latest review exists", () => {
		const checklist = buildEvidenceChecklist({
			finding: finding(),
			evidence: [],
			latestDecision: null,
			latestReview: review(),
			reportOptions: defaultReportOptions,
		});

		expect(checklist).toContainEqual(
			expect.objectContaining({
				id: "review",
				available: true,
				reference: "codex / gpt-5",
			}),
		);
	});

	it("adds a source checklist item from source-location evidence", () => {
		const checklist = buildEvidenceChecklist({
			finding: finding({ primaryLocation: null }),
			evidence: [
				evidence({
					kind: "source-location",
					title: "Source snippet",
					location: { path: "src/server.ts", startLine: 42 },
				}),
			],
			latestDecision: null,
			latestReview: null,
			reportOptions: defaultReportOptions,
		});

		expect(checklist).toContainEqual(
			expect.objectContaining({
				id: "source",
				available: true,
				reference: "src/server.ts:42",
			}),
		);
	});

	it("uses report options for includedByDefault", () => {
		expect(
			mapDecisionToReportBucket(decision({ decision: "false_positive" }), {
				includeFalsePositives: false,
				includeDeferred: true,
				includeUndecided: true,
			}).includedByDefault,
		).toBe(false);
		expect(
			mapDecisionToReportBucket(decision({ decision: "deferred" }), {
				includeFalsePositives: true,
				includeDeferred: false,
				includeUndecided: true,
			}).includedByDefault,
		).toBe(false);
		expect(
			mapDecisionToReportBucket(null, {
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: false,
			}).includedByDefault,
		).toBe(false);
	});

	it("omits verification checklist items until verification data is loaded", () => {
		const checklist = buildEvidenceChecklist({
			finding: finding(),
			evidence: [],
			latestDecision: null,
			latestReview: null,
			reportOptions: defaultReportOptions,
		});

		expect(checklist.map((item) => item.kind)).not.toContain("reproduction");
		expect(checklist.map((item) => item.kind)).not.toContain("dynamic");
		expect(checklist.map((item) => item.kind)).not.toContain("dast");
	});

	it("includes empty verification checklist items after verification data is loaded", () => {
		const checklist = buildEvidenceChecklist({
			finding: finding(),
			evidence: [],
			latestDecision: null,
			latestReview: null,
			reproductions: [],
			dynamicRuns: [],
			dastEvidence: [],
			reportOptions: defaultReportOptions,
		});

		expect(checklist).toContainEqual(
			expect.objectContaining({ kind: "reproduction", available: false }),
		);
		expect(checklist).toContainEqual(
			expect.objectContaining({ kind: "dynamic", available: false }),
		);
		expect(checklist).toContainEqual(
			expect.objectContaining({ kind: "dast", available: false }),
		);
	});

	it("recommends evidence or review and maps accepted decisions", () => {
		expect(
			buildDecisionWorkflow({
				finding: finding(),
				evidence: [evidence({ kind: "tool-output" })],
				latestDecision: null,
				latestReview: null,
				reportOptions: defaultReportOptions,
			}).recommendedReason,
		).toBe("confirmed_by_evidence");
		expect(
			buildDecisionWorkflow({
				finding: finding(),
				evidence: [],
				latestDecision: null,
				latestReview: review(),
				reportOptions: defaultReportOptions,
			}).recommendedReason,
		).toBe("confirmed_by_review");
		expect(
			mapDecisionToReportBucket(decision({ decision: "accepted" }), defaultReportOptions),
		).toMatchObject({ bucket: "accepted", includedByDefault: true });
	});
});
