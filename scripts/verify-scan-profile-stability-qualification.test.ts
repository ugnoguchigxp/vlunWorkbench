import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCatalogEntry, hashCatalogEntry } from "../api/modules/scans/profile-catalog";
import { PROFILE_STABILITY_POLICY_DEFINITIONS } from "../api/modules/scans/qualification/profile-stability-policy";
import { canonicalJson } from "../shared/canonical-json";
import { sourceTreeDigest, verifyScanProfileStabilityQualification } from "./verify-scan-profile-stability-qualification";

const digest = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let root = "";
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = ""; });

async function receipt() {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-qualification-"));
	await fs.mkdir(path.join(root, "evidence"));
	const artifactBytes = new TextEncoder().encode("{}");
	await fs.writeFile(path.join(root, "evidence", "metrics.json"), artifactBytes);
	const candidateCommit = "f1e614a53cf6e478b80c57ddc52713c5c20aae71";
	const entry = getCatalogEntry("api-readonly");
	if (!entry) throw new Error("fixture_catalog_entry_missing");
	const policy = PROFILE_STABILITY_POLICY_DEFINITIONS["api-readonly-stable-v1"];
	const tests = policy.requiredCaseIds.flatMap((caseId) =>
		[1, 2, 3].map((repetition) => ({
			testId: `${caseId}:${repetition}`,
			caseId,
			repetition,
			redactedArgv: ["bun", "run", "fixture"],
			exitCode: 0,
			durationMs: 1,
			stdoutDigest: digest(`${caseId}:out`),
			stderrDigest: digest(`${caseId}:err`),
			artifactRefs: ["metrics"],
			verdict: "passed",
		})),
	);
	const groups = policy.requiredCaseIds.map((caseId) => ({
		caseId,
		normalizedResultHashes: [digest(`${caseId}:result`), digest(`${caseId}:result`), digest(`${caseId}:result`)],
		cleanupReceiptHashes: [digest(`${caseId}:cleanup`), digest(`${caseId}:cleanup`), digest(`${caseId}:cleanup`)],
		consistent: true,
	}));
	const unsigned = {
		schemaVersion: 1, profileId: "api-readonly", candidateAvailability: "stable", candidateCommit,
		sourceTreeDigest: await sourceTreeDigest(candidateCommit), catalogEntryHash: hashCatalogEntry(entry),
		hashAlgorithms: { qualification: "rfc8785-sha256-v1", catalogEntry: "scan-profile-catalog-hash-v1", sourceTree: "git-tree-list-sha256-v1" },
		executionDefinitionHashes: [digest("execution")], policyHashes: [digest("policy")], scannerManifestHash: digest("manifest"),
		executionEnvironment: { hostOs: "linux", hostArch: "x64", containerPlatform: "linux/amd64", dockerServerVersion: "28", toolVersions: {}, imageDigests: {}, databaseDigests: {} },
		tests,
		artifacts: [{ artifactId: "metrics", kind: "gateway_metrics", relativePath: "evidence/metrics.json", byteLength: artifactBytes.byteLength, sha256: digest(artifactBytes), secretScanPassed: true }],
		metrics: { policyId: "api-readonly-stable-v1", values: policy.metricExpectations }, safety: { unauthorizedExternalRequests: 0, stateChangingScanRequests: 0, unauthorizedAuthenticationTransactionRequests: 0, secretLeaks: 0, hostMutations: 0, resourceLeaks: 0, falsePasses: 0 },
		repeatability: { requiredRunCount: 3, groups }, reviews: [], limitations: [], verdict: "passed",
	};
	const value = { ...unsigned, qualificationId: digest(canonicalJson(unsigned)) };
	const receiptPath = path.join(root, "qualification.v1.json");
	await fs.writeFile(receiptPath, JSON.stringify(value));
	return receiptPath;
}

describe("scan profile stability qualification verifier", () => {
	it("re-hashes the receipt, tree, catalog entry, and artifacts", async () => {
		const receiptPath = await receipt();
		await expect(verifyScanProfileStabilityQualification({ receiptPath, artifactRoot: root })).resolves.toMatchObject({ profileId: "api-readonly" });
		await fs.writeFile(path.join(root, "evidence", "metrics.json"), "changed");
		await expect(verifyScanProfileStabilityQualification({ receiptPath, artifactRoot: root })).rejects.toThrow("qualification_artifact_hash_mismatch");
	});

	it("rejects missing cases, incomplete repetitions, failed metrics, and inconsistent repeats", async () => {
		for (const mutate of [
			(value: any) => value.tests.pop(),
			(value: any) => { value.tests = value.tests.filter((test: any) => !(test.caseId === "cleanup" && test.repetition === 3)); },
			(value: any) => { value.metrics.values.falsePositives = 1; },
			(value: any) => { value.repeatability.groups[0].normalizedResultHashes[2] = digest("different"); },
		]) {
			const receiptPath = await receipt();
			const value = JSON.parse(await fs.readFile(receiptPath, "utf8"));
			mutate(value);
			const { qualificationId: _, ...unsigned } = value;
			value.qualificationId = digest(canonicalJson(unsigned));
			await fs.writeFile(receiptPath, JSON.stringify(value));
			await expect(verifyScanProfileStabilityQualification({ receiptPath, artifactRoot: root })).rejects.toThrow(/qualification_(case_set|repetitions|metric|repeatability)/);
			await fs.rm(root, { recursive: true, force: true });
			root = "";
		}
	});
});
