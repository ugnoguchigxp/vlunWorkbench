import {
	SCAN_PROFILE_CATALOG,
	SCAN_PROFILE_LEGACY_ASSOCIATIONS,
	listGenericStartCatalogProfileIds,
} from "../api/modules/scans/profile-catalog";
import { resolveProfileSelection } from "../api/modules/scans/profile-resolution";
import { buildScanProfileCatalogBaseline } from "./scan-profile-catalog-baseline";

const baseline = await buildScanProfileCatalogBaseline({
	generatedAt: "verification",
	sourceRevision: null,
});
const errors: string[] = [];

if (SCAN_PROFILE_CATALOG.length !== 14)
	errors.push("catalog_entry_count_invalid");
const baseLegacyVariant = baseline.variants.find(
	(variant) => variant.optionalAdapterIds.length === 0,
);
if (
	baseLegacyVariant?.definitionCount !== 22 ||
	baseLegacyVariant.enabledCount !== 20 ||
	baseLegacyVariant.disabledIds.join(",") !==
		"api-zap-active-lab,runtime-zap-active-lab"
) {
	errors.push("legacy_baseline_without_optional_adapter_invalid");
}
const legacyBaseline = baseline.variants.find((variant) =>
	variant.optionalAdapterIds.includes("semgrep"),
);
if (
	legacyBaseline?.definitionCount !== 23 ||
	legacyBaseline.enabledCount !== 21 ||
	SCAN_PROFILE_LEGACY_ASSOCIATIONS.length !== legacyBaseline.definitionCount
) {
	errors.push("legacy_association_count_invalid");
}
if (
	new Set(SCAN_PROFILE_CATALOG.map((entry) => entry.id)).size !==
	SCAN_PROFILE_CATALOG.length
) {
	errors.push("catalog_ids_not_unique");
}
for (const entry of SCAN_PROFILE_CATALOG.filter(
	(entry) => entry.availability === "planned",
)) {
	try {
		resolveProfileSelection({
			requestedProfileId: entry.id,
			surface: "cli",
			target: { kind: "full" },
			providedInputKinds: ["source_target"],
		});
		errors.push(`planned_profile_launchable:${entry.id}`);
	} catch {
		// Planned entries must be rejected by the resolver.
	}
}
const generic = listGenericStartCatalogProfileIds();
if (
	generic.some(
		(id) =>
			!SCAN_PROFILE_CATALOG.find(
				(entry) => entry.id === id && entry.availability === "stable",
			),
	)
) {
	errors.push("generic_profile_not_stable");
}

if (errors.length > 0) {
	console.error(JSON.stringify({ ok: false, errors }));
	process.exitCode = 1;
} else {
	console.log(
		JSON.stringify({
			ok: true,
			catalogEntries: SCAN_PROFILE_CATALOG.length,
			legacyDefinitions: legacyBaseline?.definitionCount ?? null,
			genericStartProfileIds: generic,
		}),
	);
}
