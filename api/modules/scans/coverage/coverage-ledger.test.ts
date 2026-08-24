import { describe, expect, it } from "vitest";
import type { ScanExecutionPlan } from "../../../../shared/schemas/scan-execution-plan.schema";
import type { ScanProfile } from "../../../../shared/schemas/scan-profile.schema";
import type { ScanProfileStepResult } from "../execution/profile-runner";
import { buildCoverageLedger } from "./coverage-ledger";

const DIGEST = `sha256:${"a".repeat(64)}`;

const profile: ScanProfile = {
	id: "ledger-test",
	name: "Ledger test",
	description: "A deterministic coverage fixture.",
	enabled: true,
	defaultTimeoutSec: 60,
	tools: [
		{
			toolId: "gitleaks",
			displayName: "Gitleaks",
			required: true,
			failurePolicy: "fail_profile",
		},
	],
	capabilityRequirements: [
		{ capabilityId: "secret_detection", requirement: "required" },
		{ capabilityId: "authentication_session", requirement: "advisory" },
	],
};

const plannedGitleaks = {
	stepId: "gitleaks",
	kind: "static_tool",
	adapter: "gitleaks",
	required: true,
	applicability: "applicable",
	readiness: "ready",
	requirement: "required_if_applicable",
	reasonCodes: [],
	evidenceRefs: [],
} satisfies ScanExecutionPlan["steps"][number];

const completedGitleaks: ScanProfileStepResult = {
	kind: "static_tool",
	toolId: "gitleaks",
	toolRunId: "tool-run",
	required: true,
	status: "completed",
	findingCount: 0,
	exitCode: 0,
	error: null,
	applicability: "applicable",
	reasonCode: null,
	coverageEffect: "covered",
	artifactIds: ["artifact-1"],
};

describe("coverage ledger", () => {
	it("derives a deterministic snapshot from only its explicit inputs", () => {
		const params = {
			profile,
			planHash: DIGEST,
			plannedSteps: [plannedGitleaks],
			derivedAt: "2026-08-21T00:00:00.000Z",
			stepResults: [completedGitleaks],
		};
		const first = buildCoverageLedger(params);
		const second = buildCoverageLedger(params);
		expect(first).toEqual(second);
		expect(first?.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capabilityId: "secret_detection",
					execution: "completed",
					coverageEffect: "covered",
				}),
				expect.objectContaining({
					capabilityId: "authentication_session",
					execution: "not_executed",
					reasonCodes: ["auth_context_missing"],
					coverageEffect: "gap",
				}),
			]),
		);
	});

	it("does not turn a missing planned result into coverage", () => {
		const ledger = buildCoverageLedger({
			profile,
			planHash: DIGEST,
			plannedSteps: [plannedGitleaks],
			derivedAt: "2026-08-21T00:00:00.000Z",
			stepResults: [],
		});
		expect(
			ledger?.entries.find(
				(entry) => entry.capabilityId === "secret_detection",
			),
		).toMatchObject({
			execution: "not_executed",
			coverageEffect: "gap",
			reasonCodes: ["capability_not_executed"],
			evidenceRefs: ["plan-step:gitleaks"],
		});
	});

	it("uses plan applicability when execution stops before a result is persisted", () => {
		const ledger = buildCoverageLedger({
			profile: {
				...profile,
				capabilityRequirements: [
					{
						capabilityId: "cicd_workflow_integrity",
						requirement: "required_if_applicable",
					},
				],
			},
			planHash: DIGEST,
			plannedSteps: [
				{
					...plannedGitleaks,
					stepId: "zizmor",
					adapter: "zizmor",
					applicability: "not_applicable",
					required: false,
					reasonCodes: ["no_auditable_github_actions_inputs"],
				},
			],
			derivedAt: "2026-08-21T00:00:00.000Z",
			stepResults: [],
		});

		expect(ledger?.entries[0]).toMatchObject({
			capabilityId: "cicd_workflow_integrity",
			applicability: "not_applicable",
			execution: "not_executed",
			coverageEffect: "covered",
			evidenceRefs: ["plan-step:zizmor"],
		});
	});

	it("binds a persisted Cosign receipt to provenance coverage", () => {
		const supplyChainProfile: ScanProfile = {
			...profile,
			id: "dependency-supply-chain",
			steps: [
				{
					kind: "attestation_verify",
					adapter: "cosign",
					displayName: "Cosign",
					required: true,
					failurePolicy: "fail_profile",
					target: { mode: "repository_relative_files" },
				},
			],
			capabilityRequirements: [
				{ capabilityId: "provenance_integrity", requirement: "required" },
			],
		};
		const ledger = buildCoverageLedger({
			profile: supplyChainProfile,
			planHash: DIGEST,
			plannedSteps: [
				{
					...plannedGitleaks,
					stepId: "attestation_verify:cosign",
					kind: "attestation_verify",
					adapter: "cosign",
				},
			],
			derivedAt: "2026-08-21T00:00:00.000Z",
			stepResults: [
				{
					kind: "attestation_verify",
					stepId: "attestation_verify:cosign",
					adapter: "cosign",
					required: true,
					status: "completed",
					applicability: "applicable",
					reasonCode: null,
					coverageEffect: "covered",
					findingCount: 0,
					error: null,
					artifactIds: ["receipt-1"],
				},
			],
		});
		expect(ledger?.entries[0]).toMatchObject({
			capabilityId: "provenance_integrity",
			execution: "completed",
			coverageEffect: "covered",
			evidenceRefs: [
				"artifact:receipt-1",
				"step-result:attestation_verify:cosign",
			],
		});
	});
});
