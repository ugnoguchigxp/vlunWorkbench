import type {
	ScanProfileCatalogEntry,
	ScanProfileInputKind,
	ScanProfileLaunchDestination,
	ScanProfileResolution,
} from "../../../shared/schemas/scan-profile-catalog.schema";
import { canonicalProfileIdSchema } from "../../../shared/schemas/scan-profile-definition.schema";
import { getCatalogEntry, hashCatalogEntry } from "./profile-catalog";
import { getScanProfileDefinition } from "./profile-definitions";
import type { ScanLaunchAttemptRepository } from "./execution/scan-launch-attempt-repository";
import {
	ProfileResolutionError,
	resolveDedicatedProfileSelection,
} from "./profile-resolution";

export type DedicatedProfileAdmission = {
	schemaVersion: 1;
	profileId: string;
	launchDestination: ScanProfileLaunchDestination;
	safetyClass: ScanProfileCatalogEntry["safetyClass"];
	catalogEntryHash: string;
	resolution: ScanProfileResolution;
};

export function admitDedicatedProfile(params: {
	canonicalProfileId: string;
	providedInputKinds: readonly ScanProfileInputKind[];
	expectedLaunchDestination: ScanProfileLaunchDestination;
}): DedicatedProfileAdmission {
	const { catalogEntry, resolution } = resolveDedicatedProfileSelection({
		canonicalProfileId: params.canonicalProfileId,
		providedInputKinds: params.providedInputKinds,
	});
	if (catalogEntry.launchDestination !== params.expectedLaunchDestination) {
		throw new ProfileResolutionError(
			"profile_not_launchable",
			"profile_destination_mismatch",
		);
	}
	const current = getCatalogEntry(catalogEntry.id);
	if (!current || hashCatalogEntry(current) !== resolution.catalogEntryHash) {
		throw new ProfileResolutionError(
			"profile_not_launchable",
			"profile_catalog_changed",
		);
	}
	return {
		schemaVersion: 1,
		profileId: catalogEntry.id,
		launchDestination: params.expectedLaunchDestination,
		safetyClass: catalogEntry.safetyClass,
		catalogEntryHash: resolution.catalogEntryHash,
		resolution,
	};
}

export function buildDedicatedProfileAdmissionMetadata(params: {
	canonicalProfileId: string;
	providedInputKinds: readonly ScanProfileInputKind[];
	expectedLaunchDestination: ScanProfileLaunchDestination;
}): Record<string, unknown> {
	const admission = admitDedicatedProfile(params);
	const catalogEntry = getCatalogEntry(admission.profileId);
	if (!catalogEntry) throw new ProfileResolutionError("profile_not_found");
	const definition = getScanProfileDefinition(
		canonicalProfileIdSchema.parse(admission.profileId),
	);
	const stepKind =
		definition.engineId === "repository"
			? "static_tool"
			: definition.engineId === "supply-artifact"
				? "container_image_scan"
				: definition.engineId === "isolated-code"
					? "dynamic_test"
					: definition.engineId === "passive-runtime"
						? "runtime_scanner"
						: definition.engineId === "controlled-active"
							? "active_transaction"
							: definition.engineId === "replay"
								? "reproduction"
								: "child_profile";
	const queuedProgressSteps = [
		...new Set(definition.variants.flatMap((variant) => variant.stepIds)),
	].map((stepId) => ({
		stepId,
		kind: stepKind,
		adapter: definition.engineId,
		displayName: stepId,
		required: true,
	}));
	return {
		profileId: catalogEntry.id,
		canonicalProfileId: catalogEntry.id,
		catalogEntry,
		profileResolution: admission.resolution,
		dedicatedAdmission: admission,
		queuedProgressSteps,
	};
}

/** Records the accepted dedicated-flow request before it creates a scan run. */
export async function createDedicatedLaunchAttempt(params: {
	repository: ScanLaunchAttemptRepository;
	projectId: string;
	createdByUserId: string;
	canonicalProfileId: string;
	providedInputKinds: readonly ScanProfileInputKind[];
	expectedLaunchDestination: ScanProfileLaunchDestination;
	sanitizedInputSummary?: Record<string, unknown>;
}) {
	const admission = admitDedicatedProfile({
		canonicalProfileId: params.canonicalProfileId,
		providedInputKinds: params.providedInputKinds,
		expectedLaunchDestination: params.expectedLaunchDestination,
	});
	const canonicalProfileId = canonicalProfileIdSchema.parse(
		admission.profileId,
	);
	const definition = getScanProfileDefinition(canonicalProfileId);
	return await params.repository.create({
		projectId: params.projectId,
		requestedProfileId: admission.profileId,
		createdByUserId: params.createdByUserId,
		canonicalProfileId,
		profileVariantId: admission.resolution.executionVariantId,
		engineId: definition.engineId,
		catalogEntryHash: admission.catalogEntryHash,
		sanitizedInputSummary: params.sanitizedInputSummary,
	});
}
