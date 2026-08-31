import { describe, expect, test } from "bun:test";
import { normalizedScannerE2EEvidence } from "./verify-scanner-e2e-repeatability";

const DIGEST = `sha256:${"a".repeat(64)}`;

function bundle(scanRunId: string) {
	return {
		contractHash: DIGEST,
		evidence: [
			{
				caseId: "gitleaks-source",
				scenarios: [
					{
						kind: "success" as const,
						scenarioType: "executed_success" as const,
						profileOutcome: "completed" as const,
						scanRunId,
						executionPlanHash: DIGEST,
						preflightHash: DIGEST,
						sourceRevisionHash: DIGEST,
						scannerManifestHash: DIGEST,
						executionHash: DIGEST,
						scannerIdentityHash: DIGEST,
						normalizedFindingHashes: [],
						normalizedEvidenceHash: DIGEST,
						scannerProcessCount: 1,
						toolRunCount: 1,
						work: { filesScanned: 1 },
						assertionIds: ["WORK-01"],
						artifacts: [
							{
								id: "00000000-0000-4000-8000-000000000001",
								kind: "raw_result",
								storageKey: `${scanRunId}/owners/tool-run/x/raw.json`,
								sha256: DIGEST,
								sizeBytes: 1,
							},
						],
						canonicalFinalReportId: "00000000-0000-4000-8000-000000000002",
						canonicalFinalArtifactId: "00000000-0000-4000-8000-000000000003",
						canonicalFinalReportCount: 1 as const,
						toolVersions: { gitleaks: "8.0.0" },
						imageDigests: [DIGEST],
						reasonCodes: [],
					},
					{
						kind: "fail_closed" as const,
						profileOutcome: "blocked" as const,
						terminationReason: "plan_changed" as const,
						scannerProcessCount: 0 as const,
						toolRunCount: 0 as const,
						canonicalFinalReportCount: 0 as const,
						artifactCount: 0 as const,
						assertionIds: ["FAIL-01"],
						reasonCodes: ["plan_changed"],
					},
				],
			},
		],
	} as never;
}

describe("scanner E2E repeatability", () => {
	test("normalizes per-run ids and artifact bytes while retaining execution identity", () => {
		expect(normalizedScannerE2EEvidence(bundle("run-a"))).toEqual(
			normalizedScannerE2EEvidence(bundle("run-b")),
		);
	});

	test("retains the normalized finding evidence identity", () => {
		const first = bundle("run-a");
		const repeat = bundle("run-b") as unknown as {
			evidence: Array<{
				scenarios: Array<{ normalizedEvidenceHash: string }>;
			}>;
		};
		repeat.evidence[0]!.scenarios[0]!.normalizedEvidenceHash =
			`sha256:${"b".repeat(64)}`;
		expect(normalizedScannerE2EEvidence(first)).not.toEqual(
			normalizedScannerE2EEvidence(repeat as never),
		);
	});
});
