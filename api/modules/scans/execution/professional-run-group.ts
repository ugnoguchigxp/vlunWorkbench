import crypto from "node:crypto";
import type { CoverageLedger } from "../../../../shared/schemas/scan-coverage-ledger.schema";
import {
	scanCapabilityIdSchema,
	type ScanCapabilityId,
} from "../../../../shared/schemas/scan-capability.schema";
import { capabilityStepIds } from "../coverage/coverage-ledger";
import type { ScanExecutionPlanV2 } from "../../../../shared/schemas/scan-execution-plan.schema";
import type { NormalizedProfileStepResult } from "../../../../shared/schemas/scan-profile-step-result.schema";
import {
	professionalRunGroupAssessmentSchema,
	professionalRunGroupPlanSchema,
	professionalRunGroupPhase56HandoffSchema,
	professionalRunGroupQualificationSchema,
	type ProfessionalRunGroupChildKind,
	type ProfessionalRunGroupAssessment,
	type ProfessionalRunGroupPlan,
	type ProfessionalRunGroupQualification,
} from "../../../../shared/schemas/professional-run-group.schema";
import { canonicalJson } from "./diff/diff-scan-plan";

const childKindByCapability: Record<
	ScanCapabilityId,
	ProfessionalRunGroupChildKind
> = {
	secret_detection: "profile",
	source_sast: "profile",
	cicd_workflow_integrity: "profile",
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
			const expectedStepIds = new Set(
				capabilityStepIds(requirement.capabilityId),
			);
			const matchingSteps = params.executionPlan.steps.filter((step) =>
				expectedStepIds.has(step.stepId),
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
	return professionalRunGroupPlanSchema.parse({
		...unsigned,
		planHash: hash(unsigned),
	});
}

/** A parent group can never auto-approve; technical completion is ledger-led. */
export function assessProfessionalRunGroup(params: {
	plan: ProfessionalRunGroupPlan;
	ledger: CoverageLedger;
	childResults: readonly NormalizedProfileStepResult[];
}) {
	const ledgerByCapability = new Map(
		params.ledger.entries.map((entry) => [entry.capabilityId, entry]),
	);
	const resultByChild = new Map(
		params.childResults.flatMap((result) =>
			result.childRunRefs.map((ref) => [ref, result] as const),
		),
	);
	const incompleteChildIds = params.plan.children
		.filter((child) => {
			if (child.requirement === "advisory") return false;
			const ledgerEntry = ledgerByCapability.get(child.capabilityId);
			const result = resultByChild.get(child.childId);
			return (
				ledgerEntry?.coverageEffect !== "covered" ||
				!result ||
				result.execution !== "completed" ||
				result.coverageEffect !== "covered" ||
				result.evidenceRefs.length === 0
			);
		})
		.map((child) => child.childId);
	const cleanupIncompleteChildIds = params.plan.children
		.filter((child) => {
			if (!child.cleanupRequired) return false;
			const result = resultByChild.get(child.childId);
			return result?.cleanupState !== "completed";
		})
		.map((child) => child.childId);
	const blockingCapabilityIds = [
		...params.plan.children
			.filter((child) => {
				const entry = ledgerByCapability.get(child.capabilityId);
				return (
					child.requirement !== "advisory" &&
					entry?.coverageEffect !== "covered"
				);
			})
			.map((child) => child.capabilityId),
		...(params.ledger.planHash === params.plan.executionPlanHash
			? []
			: params.plan.children
					.filter((child) => child.requirement !== "advisory")
					.map((child) => child.capabilityId)),
	].filter(
		(capabilityId, index, values) => values.indexOf(capabilityId) === index,
	);
	return professionalRunGroupAssessmentSchema.parse({
		schemaVersion: 1,
		parentScanRunId: params.plan.parentScanRunId,
		planHash: params.plan.planHash,
		ledgerHash: params.ledger.ledgerHash,
		technicalCompletion:
			blockingCapabilityIds.length === 0 &&
			incompleteChildIds.length === 0 &&
			cleanupIncompleteChildIds.length === 0,
		humanApproval: "pending",
		blockingCapabilityIds,
		incompleteChildIds,
		cleanupIncompleteChildIds,
	});
}

/**
 * Bind a successful technical parent run to its immutable plan and ledger.
 * The emitted qualification deliberately retains `humanApproval: pending`.
 */
export function qualifyProfessionalRunGroup(params: {
	plan: ProfessionalRunGroupPlan;
	ledger: CoverageLedger;
	assessment: ProfessionalRunGroupAssessment;
	qualifiedAt: string;
}) {
	if (
		params.assessment.parentScanRunId !== params.plan.parentScanRunId ||
		params.assessment.planHash !== params.plan.planHash ||
		params.assessment.ledgerHash !== params.ledger.ledgerHash
	) {
		throw new Error("professional_run_group_qualification_binding_mismatch");
	}
	if (!params.assessment.technicalCompletion) {
		throw new Error("professional_run_group_qualification_incomplete");
	}
	if (params.ledger.planHash !== params.plan.executionPlanHash) {
		throw new Error(
			"professional_run_group_qualification_ledger_plan_mismatch",
		);
	}
	const qualifiedCapabilityIds = params.ledger.entries
		.filter(
			(entry) =>
				entry.requirement === "advisory" || entry.coverageEffect === "covered",
		)
		.map((entry) => entry.capabilityId)
		.sort();
	if (
		qualifiedCapabilityIds.length !== params.plan.children.length ||
		params.plan.children.some(
			(child) => !qualifiedCapabilityIds.includes(child.capabilityId),
		)
	) {
		throw new Error("professional_run_group_qualification_coverage_incomplete");
	}
	const unsigned = {
		schemaVersion: 1 as const,
		qualifiedAt: params.qualifiedAt,
		parentScanRunId: params.plan.parentScanRunId,
		planHash: params.plan.planHash,
		executionPlanHash: params.plan.executionPlanHash,
		ledgerHash: params.ledger.ledgerHash,
		technicalCompletion: true as const,
		humanApproval: "pending" as const,
		qualifiedCapabilityIds,
	};
	return professionalRunGroupQualificationSchema.parse({
		...unsigned,
		qualificationHash: hash(unsigned),
	});
}

/** This is a review request, never an approval or a public claim. */
export function buildProfessionalRunGroupPhase56Handoff(params: {
	qualification: ProfessionalRunGroupQualification;
	preparedAt: string;
}) {
	return professionalRunGroupPhase56HandoffSchema.parse({
		schemaVersion: 1,
		parentScanRunId: params.qualification.parentScanRunId,
		qualificationHash: params.qualification.qualificationHash,
		preparedAt: params.preparedAt,
		targetPlan: "phase-56-capability-product-completion-plan",
		humanApproval: "pending",
		status: "ready_for_human_review",
	});
}
