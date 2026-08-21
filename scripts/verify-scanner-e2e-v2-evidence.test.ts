import { afterEach, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadScannerE2ECaseRegistryV2 } from "./scanner-e2e-v2-case-registry";
import { verifyScannerE2EV2Evidence } from "./verify-scanner-e2e-v2-evidence";

let temporaryDirectory: string | null = null;
const DIGEST = `sha256:${"a".repeat(64)}`;

afterEach(async () => {
	if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
	temporaryDirectory = null;
});

async function writeEvidence(options: { corruptWork?: boolean; omitFailure?: boolean } = {}) {
	temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-e2e-v2-evidence-"));
	const storage = path.join(temporaryDirectory, "storage");
	const { registry, contractHash } = await loadScannerE2ECaseRegistryV2();
	const evidence = [];
	for (const [index, contract] of registry.cases.entries()) {
		const scanId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
		const artifactId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
		const storageKey = `${scanId}/owners/tool-run/${artifactId}/raw/raw_result.json`;
		const bytes = Buffer.from(`fixture-${contract.id}`);
		const finalBytes = Buffer.from(`final-${contract.id}`);
		const finalStorageKey = `${scanId}/owners/report/final/canonical.json`;
		await fs.mkdir(path.dirname(path.join(storage, finalStorageKey)), { recursive: true });
		await fs.writeFile(path.join(storage, finalStorageKey), finalBytes);
		if (contract.expectedArtifactRoles.length) {
			await fs.mkdir(path.dirname(path.join(storage, storageKey)), { recursive: true });
			await fs.writeFile(path.join(storage, storageKey), bytes);
		}
		const work = Object.fromEntries(
			Object.entries(contract.workCounters).map(([name, bounds]) => [name, options.corruptWork && contract.id === "gitleaks-source" ? 0 : bounds.minimum]),
		);
		evidence.push({
			schemaVersion: 2,
			caseId: contract.id,
			contractHash,
			executedAt: "2026-08-21T00:00:00.000Z",
			scenarios: [
				{
					kind: "success",
					scenarioType: contract.expectedVerdict === "not_applicable" ? "not_applicable_success" : "executed_success",
					scanRunId: scanId,
					profileOutcome: "completed",
					executionPlanHash: DIGEST,
					preflightHash: DIGEST,
					sourceRevisionHash: DIGEST,
					scannerManifestHash: DIGEST,
					executionHash: DIGEST,
					scannerIdentityHash: DIGEST,
					normalizedFindingHashes: [],
					normalizedEvidenceHash: `sha256:${crypto
						.createHash("sha256")
						.update("[]")
						.digest("hex")}`,
					scannerProcessCount: contract.expectedVerdict === "not_applicable" ? 0 : 1,
					toolRunCount: contract.expectedVerdict === "not_applicable" ? 0 : 1,
					work,
					assertionIds: contract.requiredAssertionIds,
					artifacts: contract.expectedArtifactRoles.length
						? [{ id: artifactId, kind: contract.expectedArtifactRoles[0], storageKey, sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, sizeBytes: bytes.length }]
						: [],
					canonicalFinalReportId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
					canonicalFinalArtifactId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
					canonicalFinalReportStorageKey: finalStorageKey,
					canonicalFinalReportSha256: `sha256:${crypto.createHash("sha256").update(finalBytes).digest("hex")}`,
					canonicalFinalReportSizeBytes: finalBytes.length,
					canonicalFinalReportCount: 1,
					toolVersions: { [contract.scannerId]: "fixture-1" },
					imageDigests: [],
					reasonCodes:
						contract.expectedVerdict === "not_applicable"
							? ["schema_not_found"]
							: [],
				},
				...(options.omitFailure
					? []
					: [{
						kind: "fail_closed",
						scenarioType: "preflight_blocked",
						scanRunId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
						profileOutcome: "blocked",
						terminationReason: "plan_changed",
						scannerProcessCount: 0,
						toolRunCount: 0,
						canonicalFinalReportCount: 0,
						artifactCount: 0,
						assertionIds: ["FAIL-01"],
						reasonCodes: ["plan_changed"],
					}]),
			],
		});
	}
	const evidencePath = path.join(temporaryDirectory, "evidence.v2.json");
	await fs.writeFile(
		evidencePath,
		`${JSON.stringify({
			schemaVersion: 2,
			applicationCommit: "b".repeat(40),
			target: {
				repository: "todolist",
				commit: "d87bfdd9f29aa64e484a0c4d1ad02956136dc6b0",
				snapshotSha256: DIGEST,
			},
			toolboxImageDigest: DIGEST,
			evidence,
		})}\n`,
	);
	return evidencePath;
}

describe("scanner E2E v2 evidence verifier", () => {
	test("requires work, a byte-verifiable artifact, and a fail-closed companion for every canonical case", async () => {
		const evidencePath = await writeEvidence();
		const verified = await verifyScannerE2EV2Evidence({
			evidencePath,
			artifactRoot: path.join(temporaryDirectory!, "storage"),
			verifyTargetSnapshot: false,
		});
		expect(Object.keys(verified.evidenceHashes)).toHaveLength(12);
	});

	test("rejects a process-only work claim", async () => {
		const evidencePath = await writeEvidence({ corruptWork: true });
		await expect(
			verifyScannerE2EV2Evidence({
				evidencePath,
				artifactRoot: path.join(temporaryDirectory!, "storage"),
				verifyTargetSnapshot: false,
			}),
		).rejects.toThrow(
			"scanner_e2e_v2_work_counter_invalid:gitleaks-source:filesScanned",
		);
	});

	test("rejects a success-only bundle", async () => {
		const evidencePath = await writeEvidence({ omitFailure: true });
		await expect(
			verifyScannerE2EV2Evidence({
				evidencePath,
				artifactRoot: path.join(temporaryDirectory!, "storage"),
				verifyTargetSnapshot: false,
			}),
		).rejects.toThrow(
			"scanner_e2e_v2_scenario_set_mismatch:gitleaks-source",
		);
	});
});
