import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nightworkersSecurityIntelligenceIntegrityEvidenceSchema } from "./nightworkers-security-intelligence-integrity-evidence.schema";

const templatePath = path.resolve(
	process.cwd(),
	"spec/evidence/security-intelligence-integrity-smoke-template.json",
);

describe("NightWorkers Security Intelligence integrity evidence", () => {
	it("keeps the template not started and every capability default OFF", () => {
		const parsed = nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(
			template(),
		);
		expect(parsed.status).toBe("not_started");
		expect(parsed.integrityRun).toBeNull();
		expect(parsed.defaultActivationAuthorized).toBe(false);
		expect(Object.values(parsed.configuration).filter(Boolean)).toEqual([]);
	});

	it("accepts one authoritative run with pre/post lifecycle evidence", () => {
		expect(
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(
				completedEvidence(),
			).status,
		).toBe("completed");
	});

	it("does not duplicate the implementation run for the secondary lane", () => {
		const evidence = completedEvidence();
		evidence.integrityRun.secondaryLane.lane = "native_api";
		expect(() =>
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(evidence),
		).toThrow("security_intelligence:integrity_secondary_lane_not_distinct");
	});

	it("requires pre and post assessments to be distinct lifecycle phases", () => {
		const evidence = completedEvidence();
		evidence.integrityRun.postAssessmentRef =
			evidence.integrityRun.preAssessmentRef;
		expect(() =>
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(evidence),
		).toThrow(
			"security_intelligence:integrity_assessment_lifecycle_not_distinct",
		);
	});

	it("requires pre and post bundles to be distinct lifecycle phases", () => {
		const evidence = completedEvidence();
		evidence.integrityRun.postBundleRef = evidence.integrityRun.preBundleRef;
		expect(() =>
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(evidence),
		).toThrow("security_intelligence:integrity_bundle_lifecycle_not_distinct");
	});

	it("requires fixture alignment and every identity rejection", () => {
		const evidence = completedEvidence();
		evidence.preflight.crossRepositoryFixtureDigests.feedbackBatch = null;
		evidence.negativeChecks.wrongEvidenceSubjectRejected = false;
		expect(() =>
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(evidence),
		).toThrow("security_intelligence:integrity_preflight_incomplete");
		expect(() =>
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse({
				...evidence,
				preflight: completedPreflight(),
			}),
		).toThrow("security_intelligence:integrity_negative_check_incomplete");
	});

	it("does not complete while selected evidence remains unresolved", () => {
		const evidence = completedEvidence();
		evidence.integrityRun.evidenceResolution = "unresolved";
		evidence.integrityRun.unresolvedEvidenceRefs = ["evidence:dependency"];
		expect(() =>
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(evidence),
		).toThrow("security_intelligence:integrity_integrity_run_incomplete");
	});

	it("requires cross-Run and failure-presentation checks", () => {
		const evidence = completedEvidence();
		evidence.negativeChecks.requiredFailurePresentedAsFailure = false;
		expect(() =>
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(evidence),
		).toThrow("security_intelligence:integrity_negative_check_incomplete");
	});

	it("requires an evidence-backed decision per capability while keeping default activation unauthorized", () => {
		const evidence = completedEvidence();
		evidence.capabilityDecisions.feedbackExport = {
			decision: "pending",
			evidenceRefs: [],
		};
		expect(() =>
			nightworkersSecurityIntelligenceIntegrityEvidenceSchema.parse(evidence),
		).toThrow("security_intelligence:integrity_capability_decision_incomplete");
	});
});

function template(): Record<string, any> {
	return JSON.parse(readFileSync(templatePath, "utf8"));
}

function completedEvidence(): Record<string, any> {
	const evidence = template();
	const decision = (name: string) => ({
		decision: "go",
		evidenceRefs: [`evidence:${name}`],
	});
	return {
		...evidence,
		status: "completed",
		generatedAt: "2026-08-16T08:00:00.000Z",
		preflight: completedPreflight(),
		configuration: { ...evidence.configuration, allowedProjectCount: 1 },
		integrityRun: {
			taskRef: "task:fixture",
			taskRevisionSnapshotId: "snapshot:fixture",
			taskRevisionSnapshotDigest: `sha256:${"6".repeat(64)}`,
			runRef: "run:fixture",
			evidenceSubjectRef: "evidence-subject:fixture",
			primaryLane: "native_api",
			secondaryLane: { lane: "codex", adapterContractVerified: true },
			projectRef: "project:fixture",
			baseRevision: "a".repeat(40),
			sourceRevision: `working-tree/${"b".repeat(64)}`,
			targetDigest: `sha256:${"b".repeat(64)}`,
			preBundleRef: `sib:v1:${"1".repeat(64)}`,
			preAssessmentRef: `sia:v1:${"2".repeat(64)}`,
			securityContractRef: `sic:v1:${"6".repeat(64)}`,
			postBundleRef: `sib:v1:${"3".repeat(64)}`,
			postAssessmentRef: `sia:v1:${"4".repeat(64)}`,
			finalJudgmentRef: `sifj:v1:${"7".repeat(64)}`,
			selectedVerificationRefs: ["verification:dependency"],
			selectedEvidenceRefs: ["evidence:dependency"],
			unresolvedEvidenceRefs: [],
			evidenceResolution: "resolved",
			outcome: "no_findings_observed",
			lifecycle: {
				preAssessmentVerified: true,
				securityContractAdopted: true,
				postAssessmentVerified: true,
				finalJudgmentStored: true,
			},
			limitationCodes: [],
		},
		negativeChecks: Object.fromEntries(
			Object.keys(evidence.negativeChecks).map((key) => [key, true]),
		),
		shadowSmoke: {
			status: "completed",
			candidateBatchRef: `skcb:v1:${"8".repeat(64)}`,
			candidateReceiptRef: `skcr:v1:${"9".repeat(64)}`,
			feedbackBatchRef: `skfb:v1:${"a".repeat(64)}`,
			feedbackReceiptRef: `skfr:v1:${"b".repeat(64)}`,
			checks: Object.fromEntries(
				Object.keys(evidence.shadowSmoke.checks).map((key) => [key, true]),
			),
		},
		observations: {
			assessmentBuildLatencyMs: 12,
			endpointRequestCount: 2,
			unexpectedEndpointErrorCount: 0,
			payloadSizeBytes: 4096,
		},
		privacyAssertions: Object.fromEntries(
			Object.keys(evidence.privacyAssertions).map((key) => [key, true]),
		),
		rollbackDrill: Object.fromEntries(
			Object.keys(evidence.rollbackDrill).map((key) => [key, true]),
		),
		capabilityDecisions: {
			assessmentConsumer: decision("assessment-consumer"),
			postAssessmentGrant: decision("post-assessment-grant"),
			candidateExport: decision("candidate-export"),
			feedbackExport: decision("feedback-export"),
			shadowRetrieval: decision("shadow-retrieval"),
		},
	};
}

function completedPreflight() {
	return {
		repositoryCommits: {
			vulnWorkbench: "a".repeat(40),
			nightWorkers: "b".repeat(40),
			contextStill: "c".repeat(40),
		},
		cleanWorkingTrees: {
			vulnWorkbench: true,
			nightWorkers: true,
			contextStill: true,
		},
		crossRepositoryFixtureDigests: {
			identityMapping: `sha256:${"1".repeat(64)}`,
			assessmentBundle: `sha256:${"2".repeat(64)}`,
			scanBindingCore: `sha256:${"3".repeat(64)}`,
			candidateBatch: `sha256:${"4".repeat(64)}`,
			feedbackBatch: `sha256:${"5".repeat(64)}`,
		},
		declarationScope: "transport_integrity_only",
	};
}
