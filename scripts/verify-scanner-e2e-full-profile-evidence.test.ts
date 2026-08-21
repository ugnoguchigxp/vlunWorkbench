import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { normalizedFullProfileRun } from "./scanner-e2e-full-profile-lib";
import { verifyScannerE2EFullProfileEvidence } from "./verify-scanner-e2e-full-profile-evidence";

const roots: string[] = [];
const DIGEST = `sha256:${"a".repeat(64)}`;
const SCAN_ID = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("rejects a full-profile evidence bundle when copied artifact bytes differ", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-full-profile-"));
	roots.push(root);
	const evidencePath = path.join(root, "full-profile.v1.json");
	const storageRoot = path.join(root, "full-profile.v1.storage");
	const artifacts = await Promise.all(
		["raw_result", "sbom", "dast_raw_result"].map(async (kind) => {
			const storageKey = `${SCAN_ID}/owners/tool-run/fixture/${kind}.json`;
			const bytes = Buffer.from(kind, "utf8");
			const filePath = path.join(storageRoot, storageKey);
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, bytes);
			return {
				kind,
				storageKey,
				sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
				sizeBytes: bytes.length,
			};
		}),
	);
	const steps = [
		"gitleaks",
		"osv",
		"trivy",
		"semgrep",
		"sbom_export:trivy",
		"dast:web-passive-standard",
		"runtime_scanner:nuclei-safe",
		"runtime_scanner:zap-baseline",
		"api_schema_scan:schemathesis",
	].map((id) => ({
		id,
		status: "completed",
		applicability: "applicable",
		reasonCodes: [],
		requestCount:
			id.includes("runtime") ||
			id.startsWith("dast:") ||
			id === "api_schema_scan:schemathesis"
				? 1
				: 0,
	}));
	const unsignedRun = {
		scanRunId: SCAN_ID,
		profileOutcome: "completed",
		executionPlanHash: DIGEST,
		preflightHash: DIGEST,
		sourceRevisionHash: DIGEST,
		steps,
		scannerProcessCount: 1,
		runtimeRequestCount: 4,
		normalizedFindingHashes: [],
		toolVersions: { trivy: "1" },
		artifacts,
		canonicalFinalReportCount: 1,
		targetStartCount: 1,
		activeTargetCountAfterRun: 0,
	};
	const run = {
		...unsignedRun,
		normalizedEvidenceHash: sha256(canonicalJson(normalizedFullProfileRun(unsignedRun))),
	};
	await fs.writeFile(
		evidencePath,
		`${JSON.stringify({
			schemaVersion: 1,
			executedAt: "2026-08-21T00:00:00.000Z",
			target: { repository: "todolist", commit: "b".repeat(40) },
			apiWithoutSchemaBlock: {
				scanRunId: "00000000-0000-4000-8000-000000000003",
				profileOutcome: "blocked",
				preflightHash: DIGEST,
				sourceRevisionHash: DIGEST,
				reasonCodes: ["schema_not_found"],
				scannerProcessCount: 0,
				artifactCount: 0,
				targetStartCount: 0,
			},
			runs: [run, { ...run, scanRunId: "00000000-0000-4000-8000-000000000002" }],
		})}\n`,
	);
	await expect(
		verifyScannerE2EFullProfileEvidence({ evidencePath }),
	).resolves.toMatchObject({ executionPlanHash: DIGEST });
	await fs.writeFile(path.join(storageRoot, artifacts[0]!.storageKey), "changed");
	await expect(
		verifyScannerE2EFullProfileEvidence({ evidencePath }),
	).rejects.toThrow("scanner_e2e_full_profile_artifact_integrity_invalid");
});
