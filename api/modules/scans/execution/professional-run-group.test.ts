import { describe, expect, it } from "vitest";
import type { CoverageLedger } from "../../../../shared/schemas/scan-coverage-ledger.schema";
import type { ScanExecutionPlanV2 } from "../../../../shared/schemas/scan-execution-plan.schema";
import { scanCapabilityIdSchema } from "../../../../shared/schemas/scan-capability.schema";
import {
	assessProfessionalRunGroup,
	buildProfessionalRunGroupPlan,
} from "./professional-run-group";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const now = "2026-08-21T00:00:00.000Z";

const executionPlan: ScanExecutionPlanV2 = {
	schemaVersion: 2,
	scanRunId: "11111111-1111-4111-8111-111111111111",
	projectId: "22222222-2222-4222-8222-222222222222",
	profileId: "professional-full",
	createdAt: now,
	profileVersion: 1,
	strictness: "strict",
	sourceRevision: null,
	sourceRevisionHash: null,
	sourceSnapshotDigest: null,
	sourceState: "clean",
	resolvedProfileHash: hash("a"),
	scannerManifestHash: null,
	scannerVersionsHash: hash("b"),
	dockerImagesHash: null,
	targetPlanHash: null,
	technologyRegistryDigest: null,
	orchestrator: { id: "profile-orchestrator", version: 1, runner: "docker" },
	preflightBindingHash: hash("c"),
	preflightHash: hash("d"),
	planHash: hash("e"),
	qualificationHash: null,
	blockerCodes: [],
	warningCodes: [],
	capabilityRequirements: scanCapabilityIdSchema.options.map((capabilityId) => ({
		capabilityId,
		requirement: "required_if_applicable" as const,
	})),
	safety: { networkPolicy: "isolated", approvalRequired: false, approvalRef: null },
	steps: [
		{
			stepId: "gitleaks",
			kind: "static_tool",
			adapter: "gitleaks",
			required: true,
			applicability: "applicable",
			readiness: "ready",
			requirement: "required_if_applicable",
			reasonCodes: [],
			evidenceRefs: [],
			inputBindingHash: hash("f"),
			policyHash: hash("0"),
			budget: { timeoutSec: 60, maxRequests: null },
			cleanupRequirement: "not_required",
		},
	],
};

function ledger(effect: "covered" | "gap"): CoverageLedger {
	return {
		schemaVersion: 1,
		planHash: hash("e"),
		derivedAt: now,
		entries: [
			{
				capabilityId: "secret_detection",
				requirement: "required",
				applicability: "applicable",
				execution: effect === "covered" ? "completed" : "blocked",
				coverageEffect: effect,
				reasonCodes: effect === "covered" ? [] : ["policy_rejected"],
				evidenceRefs: [],
				limitations: [],
			},
		],
		summary: { covered: effect === "covered" ? 1 : 0, partial: 0, gap: effect === "gap" ? 1 : 0 },
		ledgerHash: hash(effect === "covered" ? "1" : "2"),
	};
}

describe("professional run group", () => {
	it("builds a deterministic parent v2 contract and keeps human approval pending", () => {
		const input = {
			parentScanRunId: executionPlan.scanRunId,
			executionPlan,
			catalogEntryHash: hash("9"),
			createdAt: now,
		};
		const first = buildProfessionalRunGroupPlan(input);
		expect(first).toEqual(buildProfessionalRunGroupPlan(input));
		expect(first).toMatchObject({
			executionPlanHash: executionPlan.planHash,
			humanReview: { required: true, status: "pending" },
		});
		expect(first.children).toContainEqual(
		expect.objectContaining({
			capabilityId: "secret_detection",
			kind: "profile",
		}),
		);
	});

	it("rejects a parent plan that omits a professional capability", () => {
		const incomplete = {
			...executionPlan,
			capabilityRequirements: executionPlan.capabilityRequirements.slice(1),
		};
		expect(() =>
			buildProfessionalRunGroupPlan({
				parentScanRunId: executionPlan.scanRunId,
				executionPlan: incomplete,
				catalogEntryHash: hash("9"),
				createdAt: now,
			}),
		).toThrow("professional_run_group_capabilities_missing:secret_detection");
	});

	it("does not claim technical completion when a required capability is a ledger gap", () => {
		const plan = buildProfessionalRunGroupPlan({
			parentScanRunId: executionPlan.scanRunId,
			executionPlan,
			catalogEntryHash: hash("9"),
			createdAt: now,
		});
		expect(assessProfessionalRunGroup({ plan, ledger: ledger("gap"), childResults: [] })).toMatchObject({
			technicalCompletion: false,
			humanApproval: "pending",
			blockingCapabilityIds: ["secret_detection"],
		});
	});
});
