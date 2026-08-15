import { describe, expect, it } from "bun:test";
import type { SecurityIntelligenceAssessmentV1 } from "../../../shared/schemas/security-intelligence-assessment.schema";
import { parseSecurityIntelligenceAssessmentV1 } from "../../../shared/security-intelligence-assessment-contract";
import {
	type BuildDependencyAssessmentInput,
	buildDependencyAssessment,
} from "./security-assessment-builder";

describe("security assessment builder", () => {
	it("matches the versioned dependency assessment baseline", async () => {
		const baseline = await Bun.file(
			new URL(
				"../../../spec/evidence/security-intelligence-dependency-baseline.json",
				import.meta.url,
			),
		).json();
		expect(baseline).toEqual({
			schemaVersion: 1,
			evidenceKind: "security_intelligence_dependency_baseline",
			assessment: buildDependencyAssessment(buildInput("tested", 0)),
		});
	});

	it.each([
		["tested", 1, "findings_observed"],
		["tested", 0, "no_findings_observed"],
		["failed", 0, "inconclusive"],
		["unavailable", 0, "unavailable"],
	] as const)(
		"maps %s with %i findings to %s",
		(status, findingCount, expectedOutcome) => {
			const input = buildInput(status, findingCount);
			const assessment = buildDependencyAssessment(input);
			expect(assessment.outcome).toBe(expectedOutcome);
			expect(parseSecurityIntelligenceAssessmentV1(assessment)).toEqual(
				assessment,
			);
		},
	);

	it("does not treat an unrelated diff as tested", () => {
		const input = buildInput("not_applicable", 0);
		input.observation.dependencyStateChanged = false;
		input.observation.gaps = [
			"No dependency manifest or lock-state change was observed",
		];
		input.observation.limitationCodes = [
			"dependency_change_not_observed",
		];
		if (input.verifications[0]) input.verifications[0].required = false;
		const assessment = buildDependencyAssessment(input);

		expect(assessment.outcome).toBe("inconclusive");
		expect(assessment.verifications[0]?.status).toBe("not_applicable");
		expect(assessment.claims).toEqual([]);
	});

	it("is deterministic across input ordering and generatedAt", () => {
		const firstInput = buildInput("tested", 1);
		const secondInput = buildInput("tested", 1);
		secondInput.generatedAt = "2026-08-15T05:02:00.000Z";
		secondInput.verifications[0]?.evidenceRefs.reverse();

		const first = buildDependencyAssessment(firstInput);
		const second = buildDependencyAssessment(secondInput);
		expect(second.assessmentRef).toBe(first.assessmentRef);
		expect(second.evidenceRefs).toEqual(first.evidenceRefs);
	});

	it("rejects unsafe persisted summaries instead of leaking them", () => {
		const input = buildInput("failed", 0);
		if (input.verifications[0]) {
			input.verifications[0].summary =
				"api_key=should-not-appear from /Users/example/private";
		}
		expect(() => buildDependencyAssessment(input)).toThrow();
	});
});

function buildInput(
	status: "failed" | "not_applicable" | "tested" | "unavailable",
	findingCount: number,
): BuildDependencyAssessmentInput {
	const manifestEvidence = evidence("artifact:manifest", "scan_artifact", "1");
	const toolEvidence = evidence("tool-run:osv", "tool_run", "2");
	const findingEvidence = evidence("finding:osv:one", "finding", "3");
	const evidenceRefs = [manifestEvidence, toolEvidence];
	const findingRefs: string[] = [];
	if (findingCount > 0) {
		evidenceRefs.push(findingEvidence);
		findingRefs.push(findingEvidence.ref);
	}
	return {
		producerVersion: "1.0.0",
		projectRef: "project:fixture",
		scanRunRef: "scan-run:fixture",
		profileRef: "diff-basic-security",
		completedAt: "2026-08-15T05:00:00.000Z",
		generatedAt: "2026-08-15T05:01:00.000Z",
		target: {
			sourceRevision: "b".repeat(40),
			targetDigest: `sha256:${"a".repeat(64)}`,
		},
		manifestEvidence,
		observation: {
			dependencyStateChanged: true,
			lockStateChanged: true,
			affectedEcosystems: ["npm dependencies"],
			covered: [
				"Dependency change applicability from the saved diff manifest",
				"Dependency manifest and lock-state changes",
				"npm dependencies change scope",
			].sort(),
			gaps: [],
			limitationCodes: [],
		},
		verifications: [
			{
				toolId: "osv",
				required: true,
				status,
				reasonCode:
					status === "tested"
						? findingCount > 0
							? "completed_with_findings"
							: "completed_without_findings"
						: status === "failed"
							? "tool_execution_failed"
							: status === "unavailable"
								? "tool_unavailable"
								: "no_dependency_manifest_changed",
				summary: summary(status, findingCount),
				evidenceRefs,
				findingRefs,
			},
		],
	};
}

function evidence(
	ref: string,
	kind: SecurityIntelligenceAssessmentV1["evidenceRefs"][number]["kind"],
	digestCharacter: string,
): SecurityIntelligenceAssessmentV1["evidenceRefs"][number] {
	return {
		ref,
		kind,
		targetRole: "assessment_target",
		scanRunRef: "scan-run:fixture",
		targetDigest: `sha256:${"a".repeat(64)}`,
		digest: `sha256:${digestCharacter.repeat(64)}`,
	};
}

function summary(
	status: "failed" | "not_applicable" | "tested" | "unavailable",
	findingCount: number,
): string {
	if (status === "tested") {
		return findingCount > 0
			? "OSV completed and reported dependency findings."
			: "OSV completed without reporting dependency findings.";
	}
	if (status === "failed") return "OSV execution failed.";
	if (status === "unavailable") return "OSV was unavailable.";
	return "OSV was not applicable to the saved diff.";
}
