import { describe, expect, it } from "vitest";
import type { DynamicRun, Finding, FindingDecision } from "../../api";
import { buildRemediationPlanView } from "./remediation-plan";

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

const decision = (
	value: FindingDecision["decision"],
	metadata: Record<string, unknown> = {},
): FindingDecision & { metadata: Record<string, unknown> } => ({
	id: "decision-1",
	findingId: "finding-1",
	decision: value,
	reason: value === "accepted" ? "accepted_risk" : "confirmed_by_evidence",
	comment: null,
	linkedReviewId: null,
	decidedByUserId: null,
	createdAt: now,
	updatedAt: now,
	metadata,
});

const dynamicRun = (): DynamicRun => ({
	id: "dynamic-1",
	findingId: "finding-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	profileConfigId: "profile-config-1",
	profileId: "default",
	dynamicKind: "test",
	status: "completed",
	outcome: "passed",
	runner: "local",
	commandJson: [],
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

describe("buildRemediationPlanView", () => {
	it("no decision returns not_started with blocking decision reason", () => {
		const result = buildRemediationPlanView({ finding: finding() });
		expect(result.status).toBe("not_started");
		expect(result.blockingReasons).toContain("decision_required");
	});

	it("needs_fix decision maps to remediation required", () => {
		const result = buildRemediationPlanView({
			finding: finding(),
			latestDecision: decision("needs_fix"),
		});
		expect(result.status).toBe("not_started");
		expect(result.verificationRequired).toBe(true);
	});

	it("accepted maps to accepted and does not require fix", () => {
		const result = buildRemediationPlanView({
			finding: finding({ severity: "medium" }),
			latestDecision: decision("accepted"),
		});
		expect(result.status).toBe("accepted");
		expect(result.blockingReasons).not.toContain("owner_required");
	});

	it("false_positive maps to false_positive", () => {
		expect(
			buildRemediationPlanView({
				finding: finding(),
				latestDecision: decision("false_positive"),
			}).status,
		).toBe("false_positive");
	});

	it("completed verification updates verification status", () => {
		expect(
			buildRemediationPlanView({
				finding: finding(),
				latestDecision: decision("needs_fix"),
				dynamicRuns: [dynamicRun()],
			}).verificationStatus,
		).toBe("passed");
	});

	it("missing owner and dueDate blocks high findings", () => {
		const result = buildRemediationPlanView({
			finding: finding({ severity: "critical" }),
			latestDecision: decision("needs_fix"),
		});
		expect(result.blockingReasons).toContain("owner_required");
		expect(result.blockingReasons).toContain("due_date_required");
	});

	it("uses persisted remediation metadata and classifies running and failed verification", () => {
		const result = buildRemediationPlanView({
			finding: finding(),
			latestDecision: decision("needs_fix", {
				remediation: {
					owner: "security",
					priority: "p1",
					dueDate: "2026-07-20",
					status: "planned",
					recommendedFix: "Sanitize output",
				},
			}),
			reproductionRuns: [{ status: "running" } as never],
		});
		expect(result.owner).toBe("security");
		expect(result.priority).toBe("p1");
		expect(result.verificationStatus).toBe("running");

		expect(
			buildRemediationPlanView({
				finding: finding(),
				latestDecision: decision("needs_fix"),
				dynamicRuns: [{ ...dynamicRun(), outcome: "failed" }],
			}).verificationStatus,
		).toBe("failed");
	});
});
