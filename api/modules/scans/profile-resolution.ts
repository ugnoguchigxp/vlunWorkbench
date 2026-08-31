import { createHash } from "node:crypto";
import type { ScanProfile } from "../../../shared/schemas/scan-profile.schema";
import {
	type ScanProfileCatalogEntry,
	type ScanProfileInputKind,
	type ScanProfileResolution,
	type ScanResultPolicy,
	scanProfileResolutionSchema,
} from "../../../shared/schemas/scan-profile-catalog.schema";
import type { ScanTarget } from "../../../shared/schemas/scan-target.schema";
import { canonicalJson } from "./execution/diff/diff-scan-plan";
import {
	getCatalogEntry,
	getCatalogEntryForResolution,
	getLegacyProfileAssociation,
	hashCatalogEntry,
} from "./profile-catalog";
import { getCanonicalProfileById, getProfileById } from "./profiles";

export type ScanProfileResolutionErrorCode =
	| "profile_not_found"
	| "profile_not_launchable"
	| "profile_experimental_not_enabled"
	| "profile_target_not_supported"
	| "profile_input_missing"
	| "profile_input_invalid"
	| "profile_result_policy_not_allowed"
	| "profile_definition_missing";

export class ProfileResolutionError extends Error {
	constructor(
		readonly code: ScanProfileResolutionErrorCode,
		message: string = code,
	) {
		super(message);
		this.name = "ProfileResolutionError";
	}
}

export type ProfileResolutionSurface =
	| "web"
	| "cli"
	| "security_oracle"
	| "nightworkers";

export function normalizeProfileResolutionInput(params: {
	repoPath?: string;
	imageRef?: string;
	imageTar?: string;
	runtimeTarget?: string;
	autoStartPlan?: boolean;
	executionConsent?: boolean;
	authContextRef?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
	slsaProvenance?: string;
	slsaPolicy?: string;
	disposableTargetRef?: string;
	rulesOfEngagementRef?: string;
	scenarioRef?: string;
	findingRef?: string;
}): ScanProfileInputKind[] {
	if (params.imageRef && params.imageTar) {
		throw new ProfileResolutionError(
			"profile_input_invalid",
			"imageRef and imageTar cannot be used together.",
		);
	}
	const inputKinds: ScanProfileInputKind[] = [];
	if (params.repoPath) inputKinds.push("source_target");
	if (params.imageRef) inputKinds.push("image_ref");
	if (params.imageTar) inputKinds.push("image_tar");
	if (params.runtimeTarget) inputKinds.push("runtime_target");
	if (params.autoStartPlan) inputKinds.push("auto_start_plan");
	if (params.executionConsent) inputKinds.push("execution_consent");
	if (params.authContextRef) inputKinds.push("auth_context_ref");
	if (params.attestationSubject) inputKinds.push("attestation_subject");
	if (params.attestationBundle) inputKinds.push("attestation_bundle");
	if (params.trustPolicy) inputKinds.push("trust_policy");
	if (params.slsaProvenance) inputKinds.push("slsa_provenance");
	if (params.slsaPolicy) inputKinds.push("slsa_policy");
	if (params.disposableTargetRef) inputKinds.push("disposable_target_ref");
	if (params.rulesOfEngagementRef) inputKinds.push("rules_of_engagement_ref");
	if (params.scenarioRef) inputKinds.push("scenario_ref");
	if (params.findingRef) inputKinds.push("finding_ref");
	return inputKinds;
}

export function resolveProfileSelection(params: {
	requestedProfileId: string;
	surface: ProfileResolutionSurface;
	target: ScanTarget;
	providedInputKinds: readonly ScanProfileInputKind[];
	requestedResultPolicy?: ScanResultPolicy;
	allowExperimental?: boolean;
	includeDeprecated?: boolean;
}): {
	resolution: ScanProfileResolution;
	catalogEntry: ScanProfileCatalogEntry;
	executionProfile: ScanProfile;
} {
	const legacyAssociation = getLegacyProfileAssociation(
		params.requestedProfileId,
	);
	if (legacyAssociation) {
		const catalogEntry = getCatalogEntryForResolution(
			legacyAssociation.canonicalProfileId,
		);
		const executionProfile = getProfileById(params.requestedProfileId);
		if (!catalogEntry || !executionProfile?.enabled) {
			throw new ProfileResolutionError("profile_not_launchable");
		}
		assertTarget(executionProfile, params.target);
		const resultPolicy = resolveResultPolicy(
			catalogEntry.allowedResultPolicies,
			// Legacy execution IDs retain their historical advisory completion
			// semantics unless a caller explicitly opts into a gate.
			"advisory",
			params.requestedResultPolicy,
		);
		return {
			catalogEntry,
			executionProfile,
			resolution: scanProfileResolutionSchema.parse({
				schemaVersion: 1,
				requestedProfileId: params.requestedProfileId,
				canonicalProfileId: catalogEntry.id,
				executionProfileId: executionProfile.id,
				executionVariantId: null,
				catalogVersion: catalogEntry.catalogVersion,
				catalogEntryHash: hashCatalogEntry(catalogEntry),
				migrationKind: legacyAssociation.migrationKind,
				launchMode: "profile_orchestrator",
				availability: catalogEntry.availability,
				strictness: executionProfile.strictness ?? "best_effort",
				resultPolicy,
				gateSeverityThreshold: catalogEntry.gateSeverityThreshold,
				providedInputKinds: [...params.providedInputKinds],
				launchability: "launchable",
				reasonCodes: [],
				warningCodes:
					catalogEntry.availability === "stable"
						? []
						: ["legacy_execution_preserved"],
			}),
		};
	}

	const catalogEntry = getCatalogEntry(params.requestedProfileId);
	if (!catalogEntry) {
		throw new ProfileResolutionError("profile_not_found");
	}
	if (catalogEntry.availability === "planned") {
		throw new ProfileResolutionError("profile_not_launchable");
	}
	if (catalogEntry.availability === "deprecated" && !params.includeDeprecated) {
		throw new ProfileResolutionError("profile_not_launchable");
	}
	if (
		catalogEntry.availability === "experimental" &&
		!params.allowExperimental
	) {
		throw new ProfileResolutionError("profile_experimental_not_enabled");
	}
	if (catalogEntry.launchMode !== "profile_orchestrator") {
		throw new ProfileResolutionError("profile_not_launchable");
	}
	if (!catalogEntry.supportedTargets.includes(params.target.kind)) {
		throw new ProfileResolutionError("profile_target_not_supported");
	}
	const variant = selectVariant(catalogEntry, params.providedInputKinds);
	const executionProfileDefinition = executionProfileFor(
		variant.executionProfileRef,
	);
	if (!executionProfileDefinition?.enabled) {
		throw new ProfileResolutionError("profile_definition_missing");
	}
	const executionProfile: ScanProfile = {
		...executionProfileDefinition,
		strictness: catalogEntry.strictness,
	};
	assertTarget(executionProfile, params.target);
	const resultPolicy = resolveResultPolicy(
		catalogEntry.allowedResultPolicies,
		catalogEntry.defaultResultPolicy,
		params.requestedResultPolicy,
	);
	return {
		catalogEntry,
		executionProfile,
		resolution: scanProfileResolutionSchema.parse({
			schemaVersion: 1,
			requestedProfileId: params.requestedProfileId,
			canonicalProfileId: catalogEntry.id,
			executionProfileId: executionProfile.id,
			executionVariantId: variant.id,
			catalogVersion: catalogEntry.catalogVersion,
			catalogEntryHash: hashCatalogEntry(catalogEntry),
			migrationKind: "canonical",
			launchMode: catalogEntry.launchMode,
			availability: catalogEntry.availability,
			strictness: executionProfile.strictness ?? catalogEntry.strictness,
			resultPolicy,
			gateSeverityThreshold: catalogEntry.gateSeverityThreshold,
			providedInputKinds: [...params.providedInputKinds],
			launchability: "launchable",
			reasonCodes: [],
			warningCodes: [],
		}),
	};
}

export function resolveDedicatedProfileSelection(params: {
	canonicalProfileId: string;
	providedInputKinds: readonly ScanProfileInputKind[];
}): {
	resolution: ScanProfileResolution;
	catalogEntry: ScanProfileCatalogEntry;
} {
	const catalogEntry = getCatalogEntry(params.canonicalProfileId);
	if (!catalogEntry) throw new ProfileResolutionError("profile_not_found");
	if (
		catalogEntry.launchMode !== "dedicated_flow" ||
		catalogEntry.availability === "planned" ||
		catalogEntry.availability === "deprecated"
	) {
		throw new ProfileResolutionError("profile_not_launchable");
	}
	const provided = new Set(params.providedInputKinds);
	const missingInputs = catalogEntry.requiredInputs
		.filter((input) => input.requirement === "required")
		.map((input) => input.kind)
		.filter((kind) => !provided.has(kind));
	if (missingInputs.length > 0) {
		throw new ProfileResolutionError(
			"profile_input_missing",
			`Missing dedicated profile inputs: ${missingInputs.join(",")}`,
		);
	}
	return {
		catalogEntry,
		resolution: scanProfileResolutionSchema.parse({
			schemaVersion: 1,
			requestedProfileId: catalogEntry.id,
			canonicalProfileId: catalogEntry.id,
			executionProfileId: null,
			executionVariantId: null,
			catalogVersion: catalogEntry.catalogVersion,
			catalogEntryHash: hashCatalogEntry(catalogEntry),
			migrationKind: "canonical",
			launchMode: "dedicated_flow",
			availability: catalogEntry.availability,
			strictness: catalogEntry.strictness,
			resultPolicy: catalogEntry.defaultResultPolicy,
			gateSeverityThreshold: catalogEntry.gateSeverityThreshold,
			providedInputKinds: [...params.providedInputKinds],
			launchability: "launchable",
			reasonCodes: [],
			warningCodes: [],
		}),
	};
}

export function buildDedicatedProfileMetadata(params: {
	canonicalProfileId: string;
	providedInputKinds: readonly ScanProfileInputKind[];
}): Record<string, unknown> {
	const { catalogEntry, resolution } = resolveDedicatedProfileSelection(params);
	return {
		profileId: catalogEntry.id,
		canonicalProfileId: catalogEntry.id,
		catalogEntry,
		profileResolution: resolution,
	};
}

export function resolveStoredScanSafetyBoundary(scan: {
	profile: string;
	metadata: unknown;
}): {
	canonicalProfileId: string;
	safetyClass: ScanProfileCatalogEntry["safetyClass"];
} | null {
	const metadata =
		scan.metadata &&
		typeof scan.metadata === "object" &&
		!Array.isArray(scan.metadata)
			? (scan.metadata as Record<string, unknown>)
			: {};
	const resolution =
		metadata.profileResolution &&
		typeof metadata.profileResolution === "object" &&
		!Array.isArray(metadata.profileResolution)
			? (metadata.profileResolution as Record<string, unknown>)
			: {};
	const candidateIds = [
		resolution.canonicalProfileId,
		metadata.canonicalProfileId,
		scan.profile,
	].filter((value): value is string => typeof value === "string");
	for (const candidateId of candidateIds) {
		const direct = getCatalogEntryForResolution(candidateId);
		if (direct) {
			return {
				canonicalProfileId: direct.id,
				safetyClass: direct.safetyClass,
			};
		}
		const association = getLegacyProfileAssociation(candidateId);
		const catalogEntry = association
			? getCatalogEntryForResolution(association.canonicalProfileId)
			: undefined;
		if (catalogEntry) {
			return {
				canonicalProfileId: catalogEntry.id,
				safetyClass: catalogEntry.safetyClass,
			};
		}
	}
	return null;
}

function selectVariant(
	entry: ScanProfileCatalogEntry,
	providedInputKinds: readonly ScanProfileInputKind[],
) {
	const provided = new Set(providedInputKinds);
	const variants = entry.executionVariants.filter(
		(variant) =>
			variant.requiredInputKinds.every((kind) => provided.has(kind)) &&
			variant.forbiddenInputKinds.every((kind) => !provided.has(kind)),
	);
	if (variants.length !== 1) {
		throw new ProfileResolutionError(
			variants.length === 0 ? "profile_input_missing" : "profile_input_invalid",
		);
	}
	const variant = variants[0];
	if (!variant) {
		throw new ProfileResolutionError("profile_input_missing");
	}
	return variant;
}

function executionProfileFor(id: string): ScanProfile | undefined {
	return getCanonicalProfileById(id) ?? getProfileById(id);
}

function assertTarget(profile: ScanProfile, target: ScanTarget): void {
	if (!(profile.supportedTargets ?? ["full"]).includes(target.kind)) {
		throw new ProfileResolutionError("profile_target_not_supported");
	}
}

function resolveResultPolicy(
	allowed: readonly ScanResultPolicy[],
	defaultResultPolicy: ScanResultPolicy,
	requested: ScanResultPolicy | undefined,
): ScanResultPolicy {
	const resultPolicy = requested ?? defaultResultPolicy;
	if (!allowed.includes(resultPolicy)) {
		throw new ProfileResolutionError("profile_result_policy_not_allowed");
	}
	return resultPolicy;
}

export function hashProfileResolution(
	resolution: ScanProfileResolution,
): string {
	return `sha256:${createHash("sha256")
		.update(canonicalJson(resolution))
		.digest("hex")}`;
}
