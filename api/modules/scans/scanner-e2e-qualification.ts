import fs from "node:fs/promises";
import path from "node:path";
import type { ScanPreflightResult } from "../../../shared/schemas/scan-preflight.schema";
import type { ScanProfileStep } from "../../../shared/schemas/scan-profile.schema";
import { SCANNER_E2E_CASE_IDS } from "../../../shared/schemas/scanner-e2e-case.schema";
import {
	type ScannerE2EQualification,
	scannerE2EQualificationSchema,
} from "../../../shared/schemas/scanner-e2e-qualification.schema";
import {
	type ScannerE2EQualificationV2,
	scannerE2EQualificationV2Schema,
} from "../../../shared/schemas/scanner-e2e-qualification-v2.schema";
import { scannerE2ECaseRegistryV2Schema } from "../../../shared/schemas/scanner-e2e-v2.schema";
import { canonicalJson } from "./diff-scan-plan";
import { hashPreflightValue } from "./scan-preflight-binding";

export type ScannerE2EQualificationCheck = {
	ready: boolean;
	reasonCode: string | null;
	qualificationHash: string | null;
	evidenceRefs: string[];
};

type ScannerE2EPreflightIdentity = Pick<
	ScanPreflightResult,
	"binding" | "checks"
>;

type UnsignedScannerE2EQualification = Omit<
	ScannerE2EQualification,
	"qualificationHash"
>;

export type AnyScannerE2EQualification =
	| ScannerE2EQualification
	| ScannerE2EQualificationV2;

const CASE_SCANNER_IDS: Record<string, string | null> = {
	"gitleaks-source": "gitleaks",
	"osv-manifest": "osv",
	"osv-installed-tree": "osv",
	"trivy-filesystem": "trivy",
	"semgrep-source": "semgrep",
	"zizmor-workflow": "zizmor",
	"trivy-sbom": "trivy",
	"trivy-image": "trivy",
	"passive-dast": null,
	"nuclei-safe": "nuclei-safe",
	"zap-baseline": null,
	"schemathesis-not-applicable": "schemathesis",
	"schemathesis-readonly": "schemathesis",
};

const REQUIRED_V2_ASSERTIONS = [
	"INV-01",
	"ENT-01",
	"PLAN-01",
	"PREF-01",
	"PROV-01",
	"WORK-01",
	"ART-01",
	"NORM-01",
	"VERDICT-01",
	"REPORT-01",
	"SAFE-01",
	"CLEAN-01",
	"FAIL-01",
];
const REQUIRED_V2_NOT_APPLICABLE_ASSERTIONS = REQUIRED_V2_ASSERTIONS.filter(
	(assertion) =>
		assertion !== "PROV-01" &&
		assertion !== "WORK-01" &&
		assertion !== "ART-01" &&
		assertion !== "NORM-01",
);

/**
 * Produces a case-scoped scanner identity. The user project revision and its
 * target-start plan are intentionally excluded: an E2E qualification proves
 * the scanner runtime, while those inputs are separately bound per scan.
 */
export function scannerE2ECaseIdentityHash(params: {
	caseId: string;
	preflight: ScannerE2EPreflightIdentity;
}): string {
	const scannerId = CASE_SCANNER_IDS[params.caseId];
	if (scannerId === undefined) {
		throw new Error(`scanner_e2e_unknown_case:${params.caseId}`);
	}
	const includeToolbox = params.caseId !== "passive-dast";
	const relevantChecks = params.preflight.checks
		.filter((check) => {
			if (check.scannerId === scannerId && scannerId !== null) return true;
			if (
				params.caseId === "passive-dast" &&
				check.kind === "browser_runtime" &&
				check.stepId === "dast:web-passive-standard"
			) {
				return true;
			}
			if (
				includeToolbox &&
				check.kind === "docker_image" &&
				check.id === "runtime:docker-image:toolbox"
			) {
				return true;
			}
			return (
				params.caseId === "zap-baseline" &&
				check.kind === "docker_image" &&
				check.id === "runtime:docker-image:zap-baseline"
			);
		})
		.map((check) => ({
			id: check.id,
			kind: check.kind,
			status: check.status,
			scannerId: check.scannerId,
			observedVersion: check.observedVersion,
			expectedVersion: check.expectedVersion,
			observedDigest: check.observedDigest,
			expectedDigest: check.expectedDigest,
			observedPlatform: check.observedPlatform ?? null,
			expectedPlatform: check.expectedPlatform ?? null,
			dataState: check.dataState,
		}))
		.sort((left, right) => left.id.localeCompare(right.id));
	return hashPreflightValue(
		canonicalJson({
			caseId: params.caseId,
			scannerManifestHash: params.preflight.binding.scannerManifestHash,
			executionHash: params.preflight.binding.executionHash,
			relevantChecks,
		}),
	);
}

export async function loadScannerE2EQualification(
	qualificationPath = process.env.VULN_WORKBENCH_SCANNER_E2E_QUALIFICATION,
): Promise<AnyScannerE2EQualification | null> {
	if (!qualificationPath) return null;
	try {
		const raw = await fs.readFile(path.resolve(qualificationPath), "utf8");
		const qualification = zodAnyQualification(JSON.parse(raw));
		return isCompleteScannerE2EQualification(qualification)
			? qualification
			: null;
	} catch {
		return null;
	}
}

/**
 * Admission checks compare against the checked-in release contract, rather
 * than trusting the contract hash embedded in a historical qualification.
 */
export async function loadScannerE2EContractHash(): Promise<string | null> {
	try {
		const contractPath = path.resolve(
			import.meta.dir,
			"../../../spec/security-capability/scanner-e2e-cases.v2.json",
		);
		const raw = await fs.readFile(contractPath, "utf8");
		const registry = scannerE2ECaseRegistryV2Schema.parse(JSON.parse(raw));
		const caseIds = registry.cases.map((entry) => entry.id);
		if (
			caseIds.length !== SCANNER_E2E_CASE_IDS.length ||
			caseIds.some((id, index) => id !== SCANNER_E2E_CASE_IDS[index])
		) {
			return null;
		}
		return hashPreflightValue(canonicalJson(registry));
	} catch {
		return null;
	}
}

export function scannerE2EQualificationHash(
	qualification: UnsignedScannerE2EQualification,
): string {
	return hashPreflightValue(canonicalJson(qualification));
}

function hasExactCanonicalCaseSet(caseIds: readonly string[]): boolean {
	return (
		caseIds.length === SCANNER_E2E_CASE_IDS.length &&
		new Set(caseIds).size === SCANNER_E2E_CASE_IDS.length &&
		SCANNER_E2E_CASE_IDS.every((caseId) => caseIds.includes(caseId))
	);
}

/** Reject partial, duplicate, or hand-assembled case maps before admission. */
export function isCompleteScannerE2EQualification(
	qualification: AnyScannerE2EQualification,
): boolean {
	const { qualificationHash, ...unsigned } = qualification;
	return (
		qualificationHash === hashPreflightValue(canonicalJson(unsigned)) &&
		hasExactCanonicalCaseSet(qualification.qualifiedCaseIds) &&
		hasExactCanonicalCaseSet(Object.keys(qualification.caseEvidenceHashes)) &&
		hasExactCanonicalCaseSet(
			Object.keys(qualification.caseScannerIdentityHashes),
		) &&
		(qualification.schemaVersion === 1 ||
			(hasExactCanonicalCaseSet(Object.keys(qualification.caseAssertionIds)) &&
				Object.entries(qualification.caseAssertionIds).every(
					([caseId, assertions]) =>
						hasExactAssertionSet(
							assertions,
							caseId === "schemathesis-not-applicable"
								? REQUIRED_V2_NOT_APPLICABLE_ASSERTIONS
								: REQUIRED_V2_ASSERTIONS,
						),
				)))
	);
}

function hasExactAssertionSet(
	actual: readonly string[],
	expected: readonly string[],
): boolean {
	return (
		actual.length === expected.length &&
		new Set(actual).size === actual.length &&
		expected.every((assertion) => actual.includes(assertion))
	);
}

function requiredCaseIdsFor(steps: ScanProfileStep[]): string[] {
	const caseIds = new Set<string>();
	for (const step of steps) {
		if (step.kind === "static_tool") {
			if (step.toolId === "gitleaks") caseIds.add("gitleaks-source");
			if (step.toolId === "semgrep") caseIds.add("semgrep-source");
			if (step.toolId === "zizmor") caseIds.add("zizmor-workflow");
			if (step.toolId === "osv") {
				caseIds.add(
					step.options?.dependencyMode === "installed_tree"
						? "osv-installed-tree"
						: "osv-manifest",
				);
			}
			if (step.toolId === "trivy") caseIds.add("trivy-filesystem");
		}
		if (step.kind === "sbom_export") caseIds.add("trivy-sbom");
		if (step.kind === "container_image_scan") caseIds.add("trivy-image");
		if (step.kind === "dast") caseIds.add("passive-dast");
		if (step.kind === "runtime_scanner") {
			caseIds.add(
				step.adapter === "nuclei-safe" ? "nuclei-safe" : "zap-baseline",
			);
		}
		if (step.kind === "api_schema_scan") {
			caseIds.add("schemathesis-not-applicable");
			caseIds.add("schemathesis-readonly");
		}
	}
	return [...caseIds].sort();
}

/**
 * Qualification is release-bound, not merely a historical green test. It is
 * mandatory for the protected CI release gate and may be enabled as an
 * explicit deployment-admission control for strict scans.
 */
export function checkScannerE2EQualification(params: {
	qualification: AnyScannerE2EQualification | null;
	steps: ScanProfileStep[];
	preflight: ScannerE2EPreflightIdentity;
	expectedContractHash: string | null;
}): ScannerE2EQualificationCheck {
	const qualification = params.qualification;
	if (!qualification) {
		return {
			ready: false,
			reasonCode: "scanner_e2e_qualification_missing",
			qualificationHash: null,
			evidenceRefs: [],
		};
	}
	if (!isCompleteScannerE2EQualification(qualification)) {
		return {
			ready: false,
			reasonCode: "scanner_e2e_qualification_mismatch",
			qualificationHash: qualification.qualificationHash,
			evidenceRefs: [],
		};
	}
	if (
		!params.expectedContractHash ||
		qualification.contractHash !== params.expectedContractHash
	) {
		return {
			ready: false,
			reasonCode: "scanner_e2e_qualification_mismatch",
			qualificationHash: qualification.qualificationHash,
			evidenceRefs: [
				`scanner-e2e-qualification:${qualification.qualificationHash}`,
			],
		};
	}
	const requiredCaseIds = requiredCaseIdsFor(params.steps);
	const casesReady = requiredCaseIds.every((id) =>
		qualification.qualifiedCaseIds.includes(id),
	);
	const bindingsMatch =
		qualification.scannerManifestHash ===
			params.preflight.binding.scannerManifestHash &&
		qualification.executionHash === params.preflight.binding.executionHash;
	const identitiesMatch = requiredCaseIds.every(
		(id) =>
			qualification.caseScannerIdentityHashes[id] ===
			scannerE2ECaseIdentityHash({ caseId: id, preflight: params.preflight }),
	);
	if (!casesReady || !bindingsMatch || !identitiesMatch) {
		return {
			ready: false,
			reasonCode: "scanner_e2e_qualification_mismatch",
			qualificationHash: qualification.qualificationHash,
			evidenceRefs: [
				`scanner-e2e-qualification:${qualification.qualificationHash}`,
			],
		};
	}
	return {
		ready: true,
		reasonCode: null,
		qualificationHash: qualification.qualificationHash,
		evidenceRefs: [
			`scanner-e2e-qualification:${qualification.qualificationHash}`,
		],
	};
}

function zodAnyQualification(value: unknown): AnyScannerE2EQualification {
	return (
		value &&
		typeof value === "object" &&
		(value as { schemaVersion?: unknown }).schemaVersion === 2
			? scannerE2EQualificationV2Schema
			: scannerE2EQualificationSchema
	).parse(value);
}
