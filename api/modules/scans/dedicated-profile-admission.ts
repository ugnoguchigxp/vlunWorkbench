import type {
	ScanProfileCatalogEntry,
	ScanProfileInputKind,
	ScanProfileLaunchDestination,
	ScanProfileResolution,
} from "../../../shared/schemas/scan-profile-catalog.schema";
import { getCatalogEntry, hashCatalogEntry } from "./profile-catalog";
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
	return {
		profileId: catalogEntry.id,
		canonicalProfileId: catalogEntry.id,
		catalogEntry,
		profileResolution: admission.resolution,
		dedicatedAdmission: admission,
	};
}
