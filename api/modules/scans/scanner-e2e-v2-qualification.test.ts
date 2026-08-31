import { describe, expect, test } from "bun:test";
import { canonicalJson, sha256 } from "../../../scripts/scanner-e2e-case-registry";
import type { ScannerE2EQualificationV2 } from "../../../shared/schemas/scanner-e2e-qualification-v2.schema";
import { isCompleteScannerE2EQualification } from "./scanner-e2e-qualification";

const DIGEST = `sha256:${"a".repeat(64)}`;
type Assertion = ScannerE2EQualificationV2["caseAssertionIds"][string][number];
const CASE_IDS = [
	"gitleaks-source",
	"osv-manifest",
	"osv-installed-tree",
	"trivy-filesystem",
	"semgrep-source",
	"zizmor-workflow",
	"trivy-sbom",
	"trivy-image",
	"passive-dast",
	"nuclei-safe",
	"zap-baseline",
	"schemathesis-not-applicable",
	"schemathesis-readonly",
];
const ASSERTIONS = [
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
].slice() as Assertion[];
const NOT_APPLICABLE_ASSERTIONS: Assertion[] = ASSERTIONS.filter(
	(assertion) => !["PROV-01", "WORK-01", "ART-01", "NORM-01"].includes(assertion),
);

function qualification(): ScannerE2EQualificationV2 {
	const unsigned = {
		schemaVersion: 2 as const,
		contractHash: DIGEST,
		qualifiedAt: "2026-08-21T00:00:00.000Z",
		applicationCommit: "b".repeat(40),
		target: {
			repository: "todolist" as const,
			commit: "c".repeat(40),
			snapshotSha256: DIGEST,
		},
		toolboxImageDigest: DIGEST,
		scannerManifestHash: DIGEST,
		executionHash: DIGEST,
		caseEvidenceHashes: Object.fromEntries(CASE_IDS.map((id) => [id, DIGEST])),
		caseScannerIdentityHashes: Object.fromEntries(CASE_IDS.map((id) => [id, DIGEST])),
		caseAssertionIds: Object.fromEntries(
			CASE_IDS.map((id) => [
				id,
				id === "schemathesis-not-applicable" ? NOT_APPLICABLE_ASSERTIONS : ASSERTIONS,
			]),
		),
		qualifiedCaseIds: CASE_IDS,
		individualEvidenceSha256: DIGEST,
		repeatEvidenceSha256: DIGEST,
		fullProfileEvidenceSha256: DIGEST,
		fullProfileExecutionPlanHash: DIGEST,
		fullProfileNormalizedEvidenceHash: DIGEST,
		canonicalFinalReportHashes: Object.fromEntries([
			...CASE_IDS.map((id) => [id, DIGEST]),
			["full-profile-1", DIGEST],
			["full-profile-2", DIGEST],
		]),
	};
	return { ...unsigned, qualificationHash: sha256(canonicalJson(unsigned)) };
}

describe("scanner E2E v2 qualification admission", () => {
	test("requires the fail-closed and work assertions in addition to the complete case set", () => {
		const valid = qualification();
		expect(isCompleteScannerE2EQualification(valid)).toBe(true);
		const { qualificationHash: _hash, ...unsigned } = valid;
		const altered = {
			...unsigned,
			caseAssertionIds: {
				...unsigned.caseAssertionIds,
				"gitleaks-source": ["FAIL-01"] as Assertion[],
			},
		};
		expect(
			isCompleteScannerE2EQualification({
				...altered,
				qualificationHash: sha256(canonicalJson(altered)),
			}),
		).toBe(false);
	});
});
