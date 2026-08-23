import crypto from "node:crypto";
import type {
	ScanCapabilityId,
	ScanCapabilityRequirementEntry,
} from "../../../../shared/schemas/scan-capability.schema";
import {
	type CoverageEffect,
	type CoverageLedger,
	type CoverageLedgerEntry,
	coverageLedgerSchema,
} from "../../../../shared/schemas/scan-coverage-ledger.schema";
import type {
	ScanProfile,
	ScanProfileStep,
} from "../../../../shared/schemas/scan-profile.schema";
import {
	type ScanReasonCode,
	scanReasonCodeSchema,
} from "../../../../shared/schemas/scan-reason-code.schema";
import type { ScanProfileStepResult } from "../execution/profile-runner";

export type {
	CoverageLedger,
	CoverageLedgerEntry,
} from "../../../../shared/schemas/scan-coverage-ledger.schema";

type CapabilityBinding = {
	stepIds: string[];
	missingReasonCode: ScanReasonCode;
};

const CAPABILITY_BINDINGS: Record<ScanCapabilityId, CapabilityBinding> = {
	secret_detection: {
		stepIds: ["gitleaks"],
		missingReasonCode: "capability_not_integrated",
	},
	source_sast: {
		stepIds: ["semgrep"],
		missingReasonCode: "source_sast_not_executed",
	},
	sca: { stepIds: ["osv"], missingReasonCode: "capability_not_integrated" },
	iac_config: {
		stepIds: ["trivy"],
		missingReasonCode: "capability_not_integrated",
	},
	sbom: {
		stepIds: ["sbom_export:trivy"],
		missingReasonCode: "capability_not_integrated",
	},
	provenance_integrity: {
		stepIds: ["attestation_verify:cosign"],
		missingReasonCode: "capability_not_integrated",
	},
	artifact_container: {
		stepIds: ["container_image_scan:trivy"],
		missingReasonCode: "image_input_not_provided",
	},
	dynamic_tests: {
		stepIds: [],
		missingReasonCode: "capability_not_integrated",
	},
	sanitizer_fuzz: {
		stepIds: [],
		missingReasonCode: "capability_not_integrated",
	},
	passive_dast: {
		stepIds: [
			"dast:web-passive-standard",
			"runtime_scanner:nuclei-safe",
			"runtime_scanner:zap-baseline",
		],
		missingReasonCode: "capability_not_integrated",
	},
	browser_client: {
		stepIds: [],
		missingReasonCode: "capability_not_integrated",
	},
	authentication_session: {
		stepIds: [],
		missingReasonCode: "auth_context_missing",
	},
	api_schema_contract: {
		stepIds: ["api_schema_scan:schemathesis"],
		missingReasonCode: "schema_not_found",
	},
	authorization_matrix: {
		stepIds: [],
		missingReasonCode: "capability_not_integrated",
	},
	active_dast: { stepIds: [], missingReasonCode: "capability_not_integrated" },
	business_logic: {
		stepIds: [],
		missingReasonCode: "capability_not_integrated",
	},
	remediation_retest: {
		stepIds: [],
		missingReasonCode: "capability_not_integrated",
	},
};

/** Shared binding source for parent orchestration; callers must not re-encode it. */
export function capabilityStepIds(capabilityId: ScanCapabilityId): string[] {
	return [...CAPABILITY_BINDINGS[capabilityId].stepIds];
}

export function buildCoverageLedger(params: {
	profile: ScanProfile;
	planHash: string;
	derivedAt: string;
	stepResults?: ScanProfileStepResult[];
}): CoverageLedger | null {
	const requirements = params.profile.capabilityRequirements;
	if (!requirements || requirements.length === 0) return null;
	const plannedStepIds = new Set(
		(params.profile.steps ?? []).map(scanProfileStepId),
	);
	const resultsByStepId = new Map(
		(params.stepResults ?? []).map((result) => [
			scanResultStepId(result),
			result,
		]),
	);
	const entries = requirements.map((requirement) =>
		buildEntry(requirement, plannedStepIds, resultsByStepId),
	);
	const summary = { covered: 0, partial: 0, gap: 0 };
	for (const entry of entries) {
		summary[entry.coverageEffect] += 1;
	}
	const unsigned = {
		schemaVersion: 1 as const,
		planHash: params.planHash,
		derivedAt: params.derivedAt,
		entries,
		summary,
	};
	return coverageLedgerSchema.parse({
		...unsigned,
		ledgerHash: sha256(canonicalJson(unsigned)),
	});
}

export function readCoverageLedger(
	metadata: Record<string, unknown> | null | undefined,
): CoverageLedger | null {
	const parsed = coverageLedgerSchema.safeParse(metadata?.coverageLedger);
	return parsed.success ? parsed.data : null;
}

function buildEntry(
	requirement: ScanCapabilityRequirementEntry,
	plannedStepIds: Set<string>,
	resultsByStepId: Map<string, ScanProfileStepResult>,
): CoverageLedgerEntry {
	const binding = CAPABILITY_BINDINGS[requirement.capabilityId];
	const matchingStepIds = binding.stepIds.filter((stepId) =>
		plannedStepIds.has(stepId),
	);
	if (matchingStepIds.length === 0) {
		return {
			capabilityId: requirement.capabilityId,
			requirement: requirement.requirement,
			applicability: "unknown",
			execution: "not_executed",
			coverageEffect: "gap",
			reasonCodes: [binding.missingReasonCode],
			evidenceRefs: [],
			limitations: ["No profile step is bound to this capability."],
		};
	}
	const results = matchingStepIds
		.map((stepId) => ({ stepId, result: resultsByStepId.get(stepId) }))
		.filter(
			(item): item is { stepId: string; result: ScanProfileStepResult } =>
				item.result !== undefined,
		);
	if (results.length !== matchingStepIds.length) {
		return {
			capabilityId: requirement.capabilityId,
			requirement: requirement.requirement,
			applicability: "applicable",
			execution: "not_executed",
			coverageEffect: "gap",
			reasonCodes: [binding.missingReasonCode],
			evidenceRefs: matchingStepIds.map((stepId) => `plan-step:${stepId}`),
			limitations: ["At least one planned step has no persisted result."],
		};
	}
	const observations = results.map(({ stepId, result }) =>
		observeStep(stepId, result),
	);
	const allNotApplicable = observations.every(
		(observation) => observation.applicability === "not_applicable",
	);
	const anyFailed = observations.some(
		(observation) => observation.execution === "failed",
	);
	const anyNotExecuted = observations.some(
		(observation) => observation.execution === "not_executed",
	);
	const coverageEffect = allNotApplicable
		? "covered"
		: anyFailed || anyNotExecuted
			? "gap"
			: worstCoverageEffect(
					observations.map((observation) => observation.coverageEffect),
				);
	return {
		capabilityId: requirement.capabilityId,
		requirement: requirement.requirement,
		applicability: allNotApplicable ? "not_applicable" : "applicable",
		execution: anyFailed
			? "failed"
			: anyNotExecuted
				? "not_executed"
				: "completed",
		coverageEffect,
		reasonCodes: unique(
			observations.flatMap((observation) => observation.reasonCodes),
		),
		evidenceRefs: unique(
			observations.flatMap((observation) => observation.evidenceRefs),
		),
		limitations: unique(
			observations.flatMap((observation) => observation.limitations),
		),
	};
}

function observeStep(stepId: string, result: ScanProfileStepResult) {
	if (result.kind === "dast") {
		const notApplicable = result.status === "skipped";
		return {
			applicability: notApplicable
				? ("not_applicable" as const)
				: ("applicable" as const),
			execution:
				result.status === "completed"
					? ("completed" as const)
					: result.status === "failed"
						? ("failed" as const)
						: ("not_executed" as const),
			coverageEffect:
				result.coverageStatus ??
				(result.status === "completed" ? "covered" : "gap"),
			reasonCodes: knownReasonCodes(
				result.limitationCodes ?? [],
				result.status,
			),
			evidenceRefs: [`step-result:${stepId}`],
			limitations: result.limitationCodes ?? [],
		};
	}
	const notApplicable = result.applicability === "not_applicable";
	return {
		applicability: notApplicable
			? ("not_applicable" as const)
			: ("applicable" as const),
		execution:
			result.status === "completed"
				? ("completed" as const)
				: result.status === "failed"
					? ("failed" as const)
					: ("not_executed" as const),
		coverageEffect:
			result.coverageEffect ??
			(result.status === "completed" ? "covered" : "gap"),
		reasonCodes: knownReasonCodes(
			result.reasonCode ? [result.reasonCode] : [],
			result.status,
		),
		evidenceRefs: [
			`step-result:${stepId}`,
			...(result.artifactIds ?? []).map((id) => `artifact:${id}`),
		],
		limitations: result.reasonCode ? [result.reasonCode] : [],
	};
}

function knownReasonCodes(
	codes: string[],
	status: "completed" | "failed" | "skipped" | "blocked",
): ScanReasonCode[] {
	const known = codes.flatMap((code) => {
		const parsed = scanReasonCodeSchema.safeParse(code);
		return parsed.success ? [parsed.data] : [];
	});
	return known.length > 0 || status === "completed"
		? unique(known)
		: ["execution_failed"];
}

function scanProfileStepId(step: ScanProfileStep): string {
	return step.kind === "static_tool"
		? step.toolId
		: step.kind === "dast"
			? `dast:${step.profileId}`
			: `${step.kind}:${step.adapter}`;
}

function scanResultStepId(result: ScanProfileStepResult): string {
	return result.kind === "static_tool"
		? result.toolId
		: result.kind === "dast"
			? `dast:${result.profileId}`
			: result.stepId;
}

function worstCoverageEffect(effects: CoverageEffect[]): CoverageEffect {
	if (effects.includes("gap")) return "gap";
	if (effects.includes("partial")) return "partial";
	return "covered";
}

function unique<T extends string>(values: T[]): T[] {
	return [...new Set(values)].sort();
}

function sha256(value: string): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
