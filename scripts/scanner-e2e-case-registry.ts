import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildScanProfiles } from "../api/modules/scans/profiles";
import { createStaticScannerAdapterRegistry } from "../api/modules/scans/static-scanner-adapters";
import type { ScanProfileStep } from "../shared/schemas/scan-profile.schema";
import {
	SCANNER_E2E_CASE_IDS,
	type ScannerE2ECaseRegistry,
	scannerE2ECaseRegistrySchema,
} from "../shared/schemas/scanner-e2e-case.schema";

/** This list is a release gate: replacing a capability with another case set is invalid. */
export const CANONICAL_SCANNER_E2E_CASE_IDS = SCANNER_E2E_CASE_IDS;

export function scannerE2EContractPath() {
	return path.resolve(
		import.meta.dir,
		"../spec/security-capability/scanner-e2e-cases.v1.json",
	);
}

export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(
		([a], [b]) => a.localeCompare(b),
	);
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function sha256(value: string): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Derive the scanner-bearing surface from enabled generic profiles. This makes
 * adding a production mode fail the contract gate until it receives a case.
 */
export function productionScannerE2ECaseIds(): string[] {
	const caseIds = new Set<string>();
	for (const profile of buildScanProfiles({
		optionalAdapterIds: ["semgrep"],
	}).filter((entry) => entry.enabled)) {
		const steps: ScanProfileStep[] =
			profile.steps ??
			profile.tools.map((tool) => ({ kind: "static_tool" as const, ...tool }));
		for (const step of steps) {
			for (const caseId of caseIdsForProductionStep(step)) caseIds.add(caseId);
		}
	}
	const adapterIds = createStaticScannerAdapterRegistry()
		.list()
		.map((adapter) => adapter.manifest.id)
		.sort();
	const requiredAdapters = ["gitleaks", "osv", "semgrep", "trivy", "zizmor"];
	if (adapterIds.join(",") !== requiredAdapters.join(",")) {
		throw new Error(
			`scanner_e2e_static_adapter_inventory_mismatch:${adapterIds.join(",")}`,
		);
	}
	return CANONICAL_SCANNER_E2E_CASE_IDS.filter((id) => caseIds.has(id));
}

/**
 * Every enabled production scanner step must have an explicit E2E case. An
 * unknown adapter must never be silently treated as another scanner's case.
 */
export function caseIdsForProductionStep(step: ScanProfileStep): string[] {
	if (step.kind === "static_tool") {
		if (step.toolId === "gitleaks") return ["gitleaks-source"];
		if (step.toolId === "semgrep") return ["semgrep-source"];
		if (step.toolId === "zizmor") return ["zizmor-workflow"];
		if (step.toolId === "trivy") return ["trivy-filesystem"];
		if (step.toolId === "osv") {
			return [
				step.options?.dependencyMode === "installed_tree"
					? "osv-installed-tree"
					: "osv-manifest",
			];
		}
		throw new Error(`scanner_e2e_static_step_unmapped:${step.toolId}`);
	} else if (step.kind === "sbom_export") {
		const adapter: string = step.adapter;
		if (adapter === "trivy") return ["trivy-sbom"];
		throw new Error(`scanner_e2e_sbom_step_unmapped:${adapter}`);
	} else if (step.kind === "container_image_scan") {
		const adapter: string = step.adapter;
		if (adapter === "trivy") return ["trivy-image"];
		throw new Error(`scanner_e2e_image_step_unmapped:${adapter}`);
	} else if (step.kind === "dast") {
		if (step.profileId === "web-passive-standard") return ["passive-dast"];
		throw new Error(`scanner_e2e_dast_step_unmapped:${step.profileId}`);
	} else if (step.kind === "runtime_scanner") {
		const adapter: string = step.adapter;
		if (adapter === "nuclei-safe") return ["nuclei-safe"];
		if (adapter === "zap-baseline") return ["zap-baseline"];
		throw new Error(`scanner_e2e_runtime_step_unmapped:${adapter}`);
	} else if (step.kind === "api_schema_scan") {
		const adapter: string = step.adapter;
		if (adapter === "schemathesis") {
			return ["schemathesis-not-applicable", "schemathesis-readonly"];
		}
		throw new Error(`scanner_e2e_api_schema_step_unmapped:${adapter}`);
	}
	throw new Error("scanner_e2e_step_kind_unmapped");
}

function profileStepId(step: ScanProfileStep): string {
	return step.kind === "static_tool"
		? step.toolId
		: step.kind === "dast"
			? `dast:${step.profileId}`
			: `${step.kind}:${step.adapter}`;
}

function validateContractBindings(registry: ScannerE2ECaseRegistry): void {
	const profiles = buildScanProfiles({
		optionalAdapterIds: ["semgrep"],
	}).filter((profile) => profile.enabled);
	for (const entry of registry.cases) {
		const profile = profiles.find(
			(candidate) => candidate.id === entry.profileId,
		);
		if (!profile) {
			throw new Error(`scanner_e2e_contract_profile_missing:${entry.id}`);
		}
		const steps =
			profile.steps ??
			profile.tools.map((tool) => ({ kind: "static_tool" as const, ...tool }));
		const matchingStep = steps.find(
			(step) => profileStepId(step) === entry.stepId,
		);
		if (
			!matchingStep ||
			!caseIdsForProductionStep(matchingStep).includes(entry.id)
		) {
			throw new Error(`scanner_e2e_contract_step_unbound:${entry.id}`);
		}
	}
}

export async function loadScannerE2ECaseRegistry(
	contractPath = scannerE2EContractPath(),
): Promise<{ registry: ScannerE2ECaseRegistry; contractHash: string }> {
	const raw = await fs.readFile(contractPath, "utf8");
	const registry = scannerE2ECaseRegistrySchema.parse(JSON.parse(raw));
	const ids = registry.cases.map((entry) => entry.id);
	if (new Set(ids).size !== ids.length) {
		throw new Error("scanner_e2e_case_ids_not_unique");
	}
	if (
		ids.length !== CANONICAL_SCANNER_E2E_CASE_IDS.length ||
		ids.some((id, index) => id !== CANONICAL_SCANNER_E2E_CASE_IDS[index])
	) {
		throw new Error("scanner_e2e_case_registry_mismatch");
	}
	if (
		productionScannerE2ECaseIds().join(",") !==
		CANONICAL_SCANNER_E2E_CASE_IDS.join(",")
	) {
		throw new Error("scanner_e2e_production_inventory_mismatch");
	}
	validateContractBindings(registry);
	return { registry, contractHash: sha256(canonicalJson(registry)) };
}
