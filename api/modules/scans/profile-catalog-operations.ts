import { createHash } from "node:crypto";
import type {
	ScanProfileCatalogEntry,
	ScanProfileLegacyAssociation,
} from "../../../shared/schemas/scan-profile-catalog.schema";
import {
	LEGACY_FULL_SECURITY_CATALOG_ENTRY,
	SCAN_PROFILE_CATALOG,
	SCAN_PROFILE_LEGACY_ASSOCIATIONS,
} from "./profile-catalog";

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function hashCatalogEntry(entry: ScanProfileCatalogEntry): string {
	return `sha256:${createHash("sha256")
		.update(canonicalJson(entry))
		.digest("hex")}`;
}

export function validateScanProfileCatalog(): void {
	const ids = new Set<string>();
	const displayOrders = new Set<number>();
	for (const entry of SCAN_PROFILE_CATALOG) {
		if (ids.has(entry.id) || displayOrders.has(entry.displayOrder)) {
			throw new Error("scan_profile_catalog_duplicate_id_or_order");
		}
		ids.add(entry.id);
		displayOrders.add(entry.displayOrder);
		if (!entry.allowedResultPolicies.includes(entry.defaultResultPolicy)) {
			throw new Error(
				`scan_profile_catalog_default_policy_not_allowed:${entry.id}`,
			);
		}
		if (
			entry.allowedResultPolicies.includes("gate") &&
			entry.gateSeverityThreshold === null
		) {
			throw new Error(
				`scan_profile_catalog_gate_threshold_missing:${entry.id}`,
			);
		}
		if (
			(entry.launchMode === "unavailable") !==
			(entry.launchDestination === null)
		) {
			throw new Error(
				`scan_profile_catalog_launch_destination_invalid:${entry.id}`,
			);
		}
		if (
			entry.launchMode !== "profile_orchestrator" &&
			entry.executionVariants.length > 0
		) {
			throw new Error(`scan_profile_catalog_non_generic_variant:${entry.id}`);
		}
		if (
			entry.launchMode === "profile_orchestrator" &&
			entry.executionVariants.length === 0
		) {
			throw new Error(
				`scan_profile_catalog_missing_execution_variant:${entry.id}`,
			);
		}
		const variantIds = new Set<string>();
		for (const variant of entry.executionVariants) {
			if (variantIds.has(variant.id)) {
				throw new Error(
					`scan_profile_catalog_duplicate_variant_id:${entry.id}:${variant.id}`,
				);
			}
			variantIds.add(variant.id);
		}
		for (let index = 0; index < entry.executionVariants.length; index++) {
			const variant = entry.executionVariants[index];
			if (!variant) continue;
			for (
				let otherIndex = index + 1;
				otherIndex < entry.executionVariants.length;
				otherIndex++
			) {
				const otherVariant = entry.executionVariants[otherIndex];
				if (!otherVariant) continue;
				if (variantsCanOverlap(variant, otherVariant)) {
					throw new Error(
						`scan_profile_catalog_ambiguous_execution_variants:${entry.id}`,
					);
				}
			}
		}
	}
	const legacyIds = new Set<string>();
	for (const association of SCAN_PROFILE_LEGACY_ASSOCIATIONS) {
		if (legacyIds.has(association.legacyProfileId)) {
			throw new Error(
				`scan_profile_catalog_duplicate_legacy_association:${association.legacyProfileId}`,
			);
		}
		legacyIds.add(association.legacyProfileId);
		if (
			!ids.has(association.canonicalProfileId) &&
			association.canonicalProfileId !== LEGACY_FULL_SECURITY_CATALOG_ENTRY.id
		) {
			throw new Error(
				`scan_profile_catalog_unknown_canonical_association:${association.legacyProfileId}`,
			);
		}
	}
	for (const target of ["full", "commit", "range", "working_tree"] as const) {
		const defaultEntry = getCatalogEntry(
			resolveDefaultCatalogProfileId(target),
		);
		if (
			defaultEntry?.availability !== "stable" ||
			defaultEntry.launchMode !== "profile_orchestrator" ||
			!defaultEntry.supportedTargets.includes(target)
		) {
			throw new Error(`scan_profile_catalog_invalid_default:${target}`);
		}
	}
}

function variantsCanOverlap(
	left: ScanProfileCatalogEntry["executionVariants"][number],
	right: ScanProfileCatalogEntry["executionVariants"][number],
): boolean {
	return (
		left.requiredInputKinds.every(
			(kind) => !right.forbiddenInputKinds.includes(kind),
		) &&
		right.requiredInputKinds.every(
			(kind) => !left.forbiddenInputKinds.includes(kind),
		)
	);
}

export function getCatalogEntry(
	id: string,
): ScanProfileCatalogEntry | undefined {
	return SCAN_PROFILE_CATALOG.find((entry) => entry.id === id);
}

export function getCatalogEntryForResolution(
	id: string,
): ScanProfileCatalogEntry | undefined {
	return id === LEGACY_FULL_SECURITY_CATALOG_ENTRY.id
		? LEGACY_FULL_SECURITY_CATALOG_ENTRY
		: getCatalogEntry(id);
}

export function getLegacyProfileAssociation(
	legacyProfileId: string,
): ScanProfileLegacyAssociation | undefined {
	return SCAN_PROFILE_LEGACY_ASSOCIATIONS.find(
		(association) => association.legacyProfileId === legacyProfileId,
	);
}

export function listPublicCatalogEntries(): ScanProfileCatalogEntry[] {
	return [...SCAN_PROFILE_CATALOG].sort(
		(left, right) => left.displayOrder - right.displayOrder,
	);
}

export function listGenericStartCatalogProfileIds(): string[] {
	return SCAN_PROFILE_CATALOG.filter(
		(entry) =>
			entry.launchMode === "profile_orchestrator" &&
			entry.availability === "stable" &&
			entry.executionVariants.some(
				(variant) =>
					variant.requiredInputKinds.every(
						(kind) => kind === "source_target",
					) && variant.forbiddenInputKinds.length === 0,
			),
	).map((entry) => entry.id);
}

export function resolveDefaultCatalogProfileId(
	target: "full" | "commit" | "range" | "working_tree",
): string {
	return target === "full" ? "source-assurance" : "change-gate";
}
