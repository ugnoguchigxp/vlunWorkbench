import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadScannerE2ECaseRegistry } from "./scanner-e2e-case-registry";
import { verifyScannerE2EEvidence } from "./verify-scanner-e2e-evidence";

const DIGEST = `sha256:${"a".repeat(64)}`;
let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
});

async function writeEvidence(
  options: { omitCaseId?: string; artifactRole?: string } = {},
) {
  const { registry, contractHash } = await loadScannerE2ECaseRegistry();
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-e2e-evidence-"));
  const evidencePath = path.join(temporaryDirectory, "evidence.json");
  const evidence = registry.cases
    .filter((entry) => entry.id !== options.omitCaseId)
    .map((entry, index) => ({
      schemaVersion: 1,
      caseId: entry.id,
      contractHash,
      status: "passed",
      verdict: entry.expectedVerdict,
      executedAt: "2026-08-21T00:00:00.000Z",
      scanRunId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      executionSurface: "profile_orchestrator",
      executionPlanHash: DIGEST,
      preflightHash: DIGEST,
      sourceRevisionHash: DIGEST,
      scannerManifestHash: DIGEST,
      executionHash: DIGEST,
			scannerIdentityHash: DIGEST,
      diagnosticRunId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      diagnosticStatus: "completed",
      canonicalFinalReportId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      canonicalFinalArtifactId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      artifactIds:
        entry.expectedArtifactRoles.length === 0
          ? []
          : [`10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`],
			artifacts:
				entry.expectedArtifactRoles.length === 0
					? []
					: [
							{
								id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
								kind:
									options.artifactRole ??
									entry.expectedArtifactRoles[0] ??
									"raw_result",
							},
						],
      toolVersions: { [entry.scannerId]: "fixture-1" },
      imageDigests: [DIGEST],
      reasonCodes: [],
    }));
  await fs.writeFile(
    evidencePath,
    `${JSON.stringify({ schemaVersion: 1, evidence })}\n`,
  );
  return evidencePath;
}

describe("scanner E2E evidence verifier", () => {
  test("accepts the exact complete canonical case set", async () => {
    const verified = await verifyScannerE2EEvidence({
      evidencePath: await writeEvidence(),
    });

    expect(Object.keys(verified.evidenceHashes)).toHaveLength(13);
  });

  test("rejects a partial bundle before it can qualify a strict scanner build", async () => {
    await expect(
      verifyScannerE2EEvidence({
        evidencePath: await writeEvidence({ omitCaseId: "zap-baseline" }),
      }),
    ).rejects.toThrow("scanner_e2e_evidence_case_set_mismatch");
  });

	test("rejects evidence that names artifacts but omits the contracted role", async () => {
		await expect(
			verifyScannerE2EEvidence({
				evidencePath: await writeEvidence({ artifactRole: "report" }),
			}),
		).rejects.toThrow(
			"scanner_e2e_evidence_artifact_role_missing:gitleaks-source:raw_result",
		);
	});
});
