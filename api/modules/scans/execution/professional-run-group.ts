import crypto from "node:crypto";
import type { CoverageLedger } from "../../../../shared/schemas/scan-coverage-ledger.schema";
import { scanCapabilityIdSchema } from "../../../../shared/schemas/scan-capability.schema";
import type { ScanExecutionPlanV2 } from "../../../../shared/schemas/scan-execution-plan.schema";
import type { NormalizedProfileStepResult } from "../../../../shared/schemas/scan-profile-step-result.schema";
import {
	professionalRunGroupAssessmentSchema,
	professionalRunGroupPlanSchema,
	type ProfessionalRunGroupChildKind,
	type ProfessionalRunGroupPlan,
} from "../../../../shared/schemas/professional-run-group.schema";
import { canonicalJson } from "./diff/diff-scan-plan";

const childKindByCapability: Record<string, ProfessionalRunGroupChildKind> = {
	secret_detection: "profile",
	source_sast: "profile",
	sca: "profile",
	iac_config: "profile",
	sbom: "profile",
	provenance_integrity: "attestation",
	artifact_container: "profile",
	dynamic_tests: "dynamic",
	sanitizer_fuzz: "dynamic",
	passive_dast: "dast",
	browser_client: "dast",
	authentication_session: "dast",
	api_schema_contract: "dast",
	authorization_matrix: "authorization",
	active_dast: "active",
	business_logic: "business",
	remediation_retest: "reproduction",
};

const hash = (value: unknown) =>
	`sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/**
 * Builds the immutable parent contract only.  Scheduling child engines remains
 * explicit: the plan is not evidence that a capability ran.
 */
export function buildProfessionalRunGroupPlan(params: {
	parentScanRunId: string;
	executionPlan: ScanExecutionPlanV2;
	catalogEntryHash: string;
	createdAt: string;
}): ProfessionalRunGroupPlan {
	const declaredCapabilities = new Set(
		params.executionPlan.capabilityRequirements.map(
			(requirement) => requirement.capabilityId,
		),
	);
	const missingCapabilities = scanCapabilityIdSchema.options.filter(
		(capabilityId) => !declaredCapabilities.has(capabilityId),
	);
	if (missingCapabilities.length > 0) {
		throw new Error(
			`professional_run_group_capabilities_missing:${missingCapabilities.join(",")}`,
		);
	}
	const children = params.executionPlan.capabilityRequirements.map(
		(requirement) => {
			const matchingSteps = params.executionPlan.steps.filter((step) =>
				step.stepId.includes(requirement.capabilityId),
			);
			const binding = matchingSteps.map((step) => step.inputBindingHash).sort();
			const policy = matchingSteps.map((step) => step.policyHash).sort();
			return {
				childId: `capability:${requirement.capabilityId}`,
				kind: childKindByCapability[requirement.capabilityId],
				capabilityId: requirement.capabilityId,
				requirement: requirement.requirement,
				inputBindingHash: hash(binding),
				policyHash: hash(policy),
				cleanupRequired: matchingSteps.some(
					(step) => step.cleanupRequirement === "required",
				),
			};
		},
	);
	const unsigned = {
		schemaVersion: 1 as const,
		parentScanRunId: params.parentScanRunId,
		executionPlanHash: params.executionPlan.planHash,
		catalogEntryHash: params.catalogEntryHash,
		createdAt: params.createdAt,
		children,
		humanReview: { required: true as const, status: "pending" as const },
	};
	return professionalRunGroupPlanSchema.parse({ ...unsigned, planHash: hash(unsigned) });
}

/** A parent group can never auto-approve; technical completion is ledger-led. */
export function assessProfessionalRunGroup(params: {
	plan: ProfessionalRunGroupPlan;
	ledger: CoverageLedger;
	childResults: readonly NormalizedProfileStepResult[];
}) {
	const resultByChild = new Map(
		params.childResults.flatMap((result) =>
			result.childRunRefs.map((ref) => [ref, result] as const),
		),
	);
	const cleanupIncompleteChildIds = params.plan.children
		.filter((child) => {
			if (!child.cleanupRequired) return false;
			const result = resultByChild.get(child.childId);
			return !result || result.cleanupState !== "completed";
		})
		.map((child) => child.childId);
	const blockingCapabilityIds = params.ledger.entries
		.filter(
			(entry) =>
				entry.requirement !== "advisory" && entry.coverageEffect !== "covered",
		)
		.map((entry) => entry.capabilityId);
	return professionalRunGroupAssessmentSchema.parse({
		schemaVersion: 1,
		parentScanRunId: params.plan.parentScanRunId,
		planHash: params.plan.planHash,
		ledgerHash: params.ledger.ledgerHash,
		technicalCompletion:
			blockingCapabilityIds.length === 0 && cleanupIncompleteChildIds.length === 0,
		humanApproval: "pending",
		blockingCapabilityIds,
		cleanupIncompleteChildIds,
	});
}
