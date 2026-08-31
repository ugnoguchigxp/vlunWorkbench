import fs from "node:fs/promises";
import path from "node:path";
import {
	type ScannerE2ECaseRegistryV2,
	scannerE2ECaseRegistryV2Schema,
} from "../shared/schemas/scanner-e2e-v2.schema";
import {
	canonicalJson,
	loadScannerE2ECaseRegistry,
	sha256,
} from "./scanner-e2e-case-registry";

export function scannerE2EContractV2Path() {
	return path.resolve(
		import.meta.dir,
		"../spec/security-capability/scanner-e2e-cases.v2.json",
	);
}

/**
 * v2 raises the evidence bar without redefining production coverage.  Its
 * case identities must remain exactly bound to the reviewed v1 inventory.
 */
export async function loadScannerE2ECaseRegistryV2(
	contractPath = scannerE2EContractV2Path(),
): Promise<{ registry: ScannerE2ECaseRegistryV2; contractHash: string }> {
	const [raw, v1] = await Promise.all([
		fs.readFile(contractPath, "utf8"),
		loadScannerE2ECaseRegistry(),
	]);
	const registry = scannerE2ECaseRegistryV2Schema.parse(JSON.parse(raw));
	const v1ById = new Map(v1.registry.cases.map((entry) => [entry.id, entry]));
	if (
		new Set(registry.cases.map((entry) => entry.id)).size !==
		registry.cases.length
	) {
		throw new Error("scanner_e2e_v2_case_ids_not_unique");
	}
	for (const entry of registry.cases) {
		const prior = v1ById.get(entry.id);
		if (
			!prior ||
			prior.scannerId !== entry.scannerId ||
			prior.mode !== entry.mode ||
			prior.profileId !== entry.profileId ||
			prior.stepId !== entry.stepId ||
			prior.expectedVerdict !== entry.expectedVerdict ||
			prior.expectedArtifactRoles.join(",") !==
				entry.expectedArtifactRoles.join(",")
		) {
			throw new Error(`scanner_e2e_v2_case_binding_mismatch:${entry.id}`);
		}
		const assertionIds = entry.requiredAssertionIds;
		if (new Set(assertionIds).size !== assertionIds.length) {
			throw new Error(`scanner_e2e_v2_assertion_ids_not_unique:${entry.id}`);
		}
	}
	if (v1ById.size !== registry.cases.length) {
		throw new Error("scanner_e2e_v2_case_set_mismatch");
	}
	return { registry, contractHash: sha256(canonicalJson(registry)) };
}
