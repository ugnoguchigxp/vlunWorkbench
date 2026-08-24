import { describe, expect, it } from "vitest";
import type { ScanPreflightResult } from "../../../shared/schemas/scan-preflight.schema";
import type { ScannerE2EQualification } from "../../../shared/schemas/scanner-e2e-qualification.schema";
import { buildScanProfiles } from "./profiles";
import {
	checkScannerE2EQualification,
	isCompleteScannerE2EQualification,
	scannerE2ECaseIdentityHash,
	scannerE2EQualificationHash,
} from "./scanner-e2e-qualification";

const DIGEST = `sha256:${"a".repeat(64)}`;

const binding: ScanPreflightResult["binding"] = {
  resolvedProfileHash: DIGEST,
  executionHash: DIGEST,
  scannerManifestHash: DIGEST,
  scannerVersionsHash: DIGEST,
  dockerImagesHash: null,
  targetPlanHash: null,
  sourceRevisionHash: DIGEST,
};

const preflight = { binding, checks: [] };

const caseIds = [
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

function qualification(
  overrides: Partial<ScannerE2EQualification> = {},
): ScannerE2EQualification {
	const base: Omit<ScannerE2EQualification, "qualificationHash"> = {
    schemaVersion: 1,
    contractHash: DIGEST,
    qualifiedAt: "2026-08-21T00:00:00.000Z",
    scannerManifestHash: DIGEST,
    executionHash: DIGEST,
    caseEvidenceHashes: {
      "gitleaks-source": DIGEST,
      "osv-installed-tree": DIGEST,
      "trivy-filesystem": DIGEST,
      "semgrep-source": DIGEST,
      "zizmor-workflow": DIGEST,
      "trivy-sbom": DIGEST,
      "passive-dast": DIGEST,
      "nuclei-safe": DIGEST,
      "zap-baseline": DIGEST,
      "schemathesis-not-applicable": DIGEST,
      "schemathesis-readonly": DIGEST,
      "osv-manifest": DIGEST,
      "trivy-image": DIGEST,
    },
    caseScannerIdentityHashes: Object.fromEntries(
      caseIds.map((caseId) => [
        caseId,
        scannerE2ECaseIdentityHash({ caseId, preflight }),
      ]),
    ),
    qualifiedCaseIds: caseIds,
  };
	const { qualificationHash, ...unsignedOverrides } = overrides;
	const unsigned = { ...base, ...unsignedOverrides };
	return {
		...unsigned,
		qualificationHash:
			qualificationHash ?? scannerE2EQualificationHash(unsigned),
	};
}

describe("scanner E2E qualification", () => {
  it("fails closed when a strict scan has no qualification", () => {
    const profile = buildScanProfiles().find(
      (candidate) => candidate.id === "full-security-scan",
    )!;
    expect(
      checkScannerE2EQualification({
        qualification: null,
        steps: profile.steps!,
        preflight,
		expectedContractHash: DIGEST,
      }),
    ).toMatchObject({
      ready: false,
      reasonCode: "scanner_e2e_qualification_missing",
    });
  });

	it("accepts all relevant qualified cases only with exact scanner identities", () => {
    const profile = buildScanProfiles().find(
      (candidate) => candidate.id === "full-security-scan",
    )!;
    expect(
      checkScannerE2EQualification({
        qualification: qualification(),
        steps: profile.steps!,
        preflight,
		expectedContractHash: DIGEST,
      }),
		).toMatchObject({ ready: true });
    expect(
      checkScannerE2EQualification({
        qualification: qualification({
			caseScannerIdentityHashes: {
				...qualification().caseScannerIdentityHashes,
				"gitleaks-source": `sha256:${"b".repeat(64)}`,
			},
        }),
        steps: profile.steps!,
        preflight,
		expectedContractHash: DIGEST,
      }),
		).toMatchObject({
			ready: false,
			reasonCode: "scanner_e2e_qualification_mismatch",
		});
	});

	it("rejects a stale contract or an altered qualification document", () => {
		const profile = buildScanProfiles().find(
			(candidate) => candidate.id === "full-security-scan",
		)!;
		expect(
			checkScannerE2EQualification({
				qualification: qualification(),
				steps: profile.steps!,
				preflight,
				expectedContractHash: `sha256:${"b".repeat(64)}`,
			}),
		).toMatchObject({
			ready: false,
			reasonCode: "scanner_e2e_qualification_mismatch",
		});
		expect(
			isCompleteScannerE2EQualification(
				qualification({ qualificationHash: `sha256:${"b".repeat(64)}` }),
			),
		).toBe(false);
	});

	it("rejects a duplicate or partial case map before a profile can be admitted", () => {
		const incomplete = qualification({
			qualifiedCaseIds: Array.from(
				{ length: 13 },
				() => "gitleaks-source",
			),
		});
		expect(isCompleteScannerE2EQualification(incomplete)).toBe(false);
		const profile = buildScanProfiles().find(
			(candidate) => candidate.id === "full-security-scan",
		)!;
		expect(
			checkScannerE2EQualification({
				qualification: incomplete,
				steps: profile.steps!,
				preflight,
				expectedContractHash: DIGEST,
			}),
		).toMatchObject({
			ready: false,
			reasonCode: "scanner_e2e_qualification_mismatch",
		});
	});
});
