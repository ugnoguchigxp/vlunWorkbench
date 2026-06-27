import { describe, expect, it } from "vitest";
import type {
	Finding,
	FindingDecision,
	FindingReview,
	ReproductionRun,
} from "../../api";
import {
	buildEvidenceQuality,
	deriveEvidenceDataCompleteness,
} from "./evidence-quality";

const now = "2026-06-27T00:00:00.000Z";

const finding = (overrides: Partial<Finding> = {}): Finding => ({
	id: "finding-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	sourceTool: "semgrep",
	ruleId: "rule.xss",
	title: "XSS",
	description: "unsafe output",
	severity: "high",
	confidence: "static",
	status: "open",
	primaryLocation: { path: "src/app.ts", startLine: 10 },
	fingerprint: "fp-1",
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const review = (
	level: "weak" | "moderate" | "strong" | "unknown" = "moderate",
): Partial<FindingReview> => ({
	id: "review-1",
	findingId: "finding-1",
	provider: "codex",
	model: "gpt-5",
	status: "completed",
	evidenceStrength: { level, reasoning: "reason" },
});

const decision = (decisionValue: FindingDecision["decision"]): FindingDecision => ({
	id: "decision-1",
	findingId: "finding-1",
	decision: decisionValue,
	reason: "confirmed_by_evidence",
	comment: null,
	linkedReviewId: null,
	decidedByUserId: null,
	createdAt: now,
	updatedAt: now,
});

const reproduction = (): ReproductionRun => ({
	id: "repro-1",
	findingId: "finding-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	profileId: "default",
	status: "completed",
	outcome: "reproduced",
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
});

describe("buildEvidenceQuality", () => {
	it("source location only returns weak", () => {
		expect(buildEvidenceQuality({ finding: finding() }).level).toBe("weak");
	});

	it("source plus completed review returns moderate", () => {
		expect(
			buildEvidenceQuality({ finding: finding(), latestReview: review() }).level,
		).toBe("moderate");
	});

	it("source plus completed reproduction returns strong", () => {
		expect(
			buildEvidenceQuality({
				finding: finding(),
				reproductionRuns: [reproduction()],
			}).level,
		).toBe("strong");
	});

	it("missing location and evidence returns missing", () => {
		expect(
			buildEvidenceQuality({
				finding: finding({ primaryLocation: null, metadata: {} }),
				evidence: [],
			}).level,
		).toBe("missing");
	});

	it("weak LLM evidence does not become moderate", () => {
		expect(
			buildEvidenceQuality({
				finding: finding(),
				latestReview: review("weak"),
			}).level,
		).toBe("weak");
	});

	it("accepted decision with no technical evidence is not strong", () => {
		expect(
			buildEvidenceQuality({
				finding: finding({ primaryLocation: null, metadata: {} }),
				latestDecision: decision("accepted"),
			}).level,
		).not.toBe("strong");
	});

	it("does not require a human decision after LLM review and verification", () => {
		const result = buildEvidenceQuality({
			finding: finding(),
			latestReview: review("strong"),
			reproductionRuns: [reproduction()],
			});
			expect(result.recommendedNextAction).toBe("ready_for_report");
			expect(result.reasons).not.toContain("監査判断履歴があります。");
		});

	it("marks list-only data as summary_only", () => {
		expect(
			deriveEvidenceDataCompleteness({
				hasFindingDetails: false,
				hasVerificationData: false,
				hasDastEvidenceLoaded: false,
			}),
		).toBe("summary_only");
	});

	it("marks details without verification as partial", () => {
		expect(
			deriveEvidenceDataCompleteness({
				hasFindingDetails: true,
				hasVerificationData: false,
				hasDastEvidenceLoaded: false,
			}),
		).toBe("partial");
	});

	it("marks loaded details with verification as complete", () => {
		expect(
			deriveEvidenceDataCompleteness({
				hasFindingDetails: true,
				hasVerificationData: true,
				hasDastEvidenceLoaded: false,
			}),
		).toBe("complete");
	});
});
