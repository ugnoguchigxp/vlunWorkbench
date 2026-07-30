import { describe, expect, it } from "vitest";
import {
	automatedDiagnosticRunSchema,
	automatedScanReviewOutputSchema,
} from "./automated-diagnostic.schema";

describe("automated diagnostic schemas", () => {
	it("accepts evidence-constrained finding assessments", () => {
		const findingId = "11111111-1111-4111-8111-111111111111";
		const parsed = automatedScanReviewOutputSchema.parse({
			summary: "要約",
			riskOverview: "リスク",
			priorityNotes: [],
			coverageNotes: [],
			falsePositiveHotspots: [],
			recommendedNextActions: [],
			findingTriageHints: [],
			confidenceNotes: [],
			improvementRequest: {
				title: "改善",
				objective: "改善する",
				scope: [],
				priorityPlan: [],
				implementationTasks: [],
				acceptanceCriteria: [],
				verificationCommands: [],
				constraints: [],
				nonGoals: [],
				handoffPrompt: "改善してください",
			},
			findingAssessments: [
				{
					findingId,
					criticality: "high",
					criticalityRationale: "証跡に基づく評価",
					falsePositiveLikelihood: "low",
					exploitability: "possible",
					businessImpact: "利用者への影響",
					priority: "high",
					remediation: "境界で検証する",
					evidenceRefs: [{ kind: "finding", id: findingId }],
					assumptions: [],
					unknowns: [],
				},
			],
			systemicRiskThemes: [],
			limitations: [],
		});
		expect(parsed.findingAssessments[0]?.criticality).toBe("high");
	});

	it("rejects unsupported assessment enum values", () => {
		const result = automatedScanReviewOutputSchema.safeParse({
			findingAssessments: [
				{
					criticality: "urgent",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("validates persisted diagnostic hashes and readiness", () => {
		const now = new Date().toISOString();
		const parsed = automatedDiagnosticRunSchema.parse({
			id: "11111111-1111-4111-8111-111111111111",
			scanRunId: "22222222-2222-4222-8222-222222222222",
			inputSnapshotHash: "a".repeat(64),
			scannerProvenanceHash: "b".repeat(64),
			pipelineVersion: "automated-scan-diagnostic-v1",
			status: "completed_with_limitations",
			readiness: "ready_with_limitations",
			scanReviewId: null,
			scanReportId: "33333333-3333-4333-8333-333333333333",
			limitationCodes: ["llm_unavailable"],
			errorMessage: null,
			attemptCount: 1,
			startedAt: now,
			completedAt: now,
			createdAt: now,
			updatedAt: now,
		});
		expect(parsed.readiness).toBe("ready_with_limitations");
	});
});
