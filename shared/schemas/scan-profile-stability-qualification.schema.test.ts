import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../canonical-json";
import {
	scanProfileStabilityQualificationV1Schema,
	type ScanProfileStabilityQualificationV1,
} from "./scan-profile-stability-qualification.schema";

const digest = (value: string) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;

function qualification(
	overrides: Partial<ScanProfileStabilityQualificationV1> = {},
): ScanProfileStabilityQualificationV1 {
	const unsigned = {
		schemaVersion: 1 as const,
		profileId: "api-readonly" as const,
		candidateAvailability: "stable" as const,
		candidateCommit: "a".repeat(40),
		sourceTreeDigest: digest("tree"),
		catalogEntryHash: digest("catalog"),
		hashAlgorithms: { qualification: "rfc8785-sha256-v1" as const, catalogEntry: "scan-profile-catalog-hash-v1" as const, sourceTree: "git-tree-list-sha256-v1" as const },
		executionDefinitionHashes: [digest("execution")],
		policyHashes: [digest("policy")],
		scannerManifestHash: digest("manifest"),
		executionEnvironment: { hostOs: "linux" as const, hostArch: "x64" as const, containerPlatform: "linux/amd64" as const, dockerServerVersion: "28.0", toolVersions: {}, imageDigests: {}, databaseDigests: {} },
		tests: [{ testId: "api:case:1", caseId: "api:case", repetition: 1, redactedArgv: ["bun", "run", "fixture"], exitCode: 0, durationMs: 1, stdoutDigest: digest("out"), stderrDigest: digest("err"), artifactRefs: ["metrics"], verdict: "passed" as const }],
		artifacts: [{ artifactId: "metrics", kind: "gateway_metrics", relativePath: "evidence/metrics.json", byteLength: 2, sha256: digest("{}"), secretScanPassed: true as const }],
		metrics: { policyId: "api-readonly-stable-v1", values: {} },
		safety: { unauthorizedExternalRequests: 0, stateChangingScanRequests: 0, unauthorizedAuthenticationTransactionRequests: 0, secretLeaks: 0, hostMutations: 0, resourceLeaks: 0, falsePasses: 0 },
		repeatability: { requiredRunCount: 3 as const, groups: [{ caseId: "api:case", normalizedResultHashes: [digest("result"), digest("result"), digest("result")], cleanupReceiptHashes: [digest("cleanup"), digest("cleanup"), digest("cleanup")], consistent: true as const }] },
		reviews: [], limitations: [], verdict: "passed" as const,
	};
	const candidate = { ...unsigned, ...overrides };
	return scanProfileStabilityQualificationV1Schema.parse({
		...candidate,
		qualificationId: digest(canonicalJson(candidate)),
	});
}

describe("scan profile stability qualification schema", () => {
	it("accepts a complete, secret-safe passing receipt", () => {
		expect(qualification().qualificationId).toMatch(/^sha256:/);
	});

	it("rejects a false pass or a missing artifact reference", () => {
		const unsafe = qualification();
		expect(scanProfileStabilityQualificationV1Schema.safeParse({ ...unsafe, safety: { ...unsafe.safety, hostMutations: 1 } }).success).toBe(false);
		expect(scanProfileStabilityQualificationV1Schema.safeParse({ ...unsafe, tests: [{ ...unsafe.tests[0], artifactRefs: ["missing"] }] }).success).toBe(false);
	});
});
