import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildScanProfileStabilityQualification } from "./build-scan-profile-stability-qualification";

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let root = "";
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

describe("scan profile qualification builder", () => {
	it("replaces caller artifact metadata with hashes of the actual artifact", async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-builder-"));
		await fs.mkdir(path.join(root, "evidence"));
		await fs.writeFile(path.join(root, "evidence", "result.json"), "{}", "utf8");
		const unsigned = { schemaVersion: 1, profileId: "api-readonly", candidateAvailability: "stable", candidateCommit: "a".repeat(40), sourceTreeDigest: hash("tree"), catalogEntryHash: hash("catalog"), hashAlgorithms: { qualification: "rfc8785-sha256-v1", catalogEntry: "scan-profile-catalog-hash-v1", sourceTree: "git-tree-list-sha256-v1" }, executionDefinitionHashes: [hash("execution")], policyHashes: [hash("policy")], scannerManifestHash: hash("manifest"), executionEnvironment: { hostOs: "linux", hostArch: "x64", containerPlatform: "linux/amd64", dockerServerVersion: "28", toolVersions: {}, imageDigests: {}, databaseDigests: {} }, tests: [{ testId: "case:1", caseId: "case", repetition: 1, redactedArgv: ["bun"], exitCode: 0, durationMs: 1, stdoutDigest: hash("out"), stderrDigest: hash("err"), artifactRefs: ["result"], verdict: "passed" }], artifacts: [{ artifactId: "result", kind: "result", relativePath: "evidence/result.json", byteLength: 999, sha256: hash("forged"), secretScanPassed: true }], metrics: { policyId: "api-readonly-stable-v1", values: {} }, safety: { unauthorizedExternalRequests: 0, stateChangingScanRequests: 0, unauthorizedAuthenticationTransactionRequests: 0, secretLeaks: 0, hostMutations: 0, resourceLeaks: 0, falsePasses: 0 }, repeatability: { requiredRunCount: 3, groups: [{ caseId: "case", normalizedResultHashes: [hash("r"), hash("r"), hash("r")], cleanupReceiptHashes: [hash("c"), hash("c"), hash("c")], consistent: true }] }, reviews: [], limitations: [], verdict: "passed" };
		const unsignedPath = path.join(root, "unsigned.json"); const outputPath = path.join(root, "qualification.json");
		await fs.writeFile(unsignedPath, JSON.stringify(unsigned));
		const receipt = await buildScanProfileStabilityQualification({ unsignedPath, artifactRoot: root, outputPath });
		expect(receipt.artifacts[0]).toMatchObject({ byteLength: 2, sha256: hash("{}") });
	});

	it("refuses receipt generation when the unsigned candidate is not the clean checkout", async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-builder-"));
		const unsignedPath = path.join(root, "unsigned.json");
		await fs.writeFile(unsignedPath, JSON.stringify({ candidateCommit: "a".repeat(40) }));
		await expect(
			buildScanProfileStabilityQualification({
				unsignedPath,
				artifactRoot: root,
				outputPath: path.join(root, "qualification.json"),
				requireCleanCandidate: true,
				candidateRepositoryPath: process.cwd(),
			}),
		).rejects.toThrow("qualification_candidate_commit_mismatch");
	});
});
