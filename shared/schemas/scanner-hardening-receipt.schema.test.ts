import { describe, expect, test } from "vitest";
import {
	scannerHardeningCiReceiptSchema,
	scannerHardeningCloseoutReceiptSchema,
} from "./scanner-hardening-receipt.schema";

const commit = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const timestamp = "2026-08-21T00:00:00.000Z";
const file = (name: string) => ({ path: name, sha256: digest, sizeBytes: 1 });
const results = (prefix: string, length: number, status = "passed") =>
	Array.from({ length }, (_, index) => ({
		id: `${prefix}-${index + 1}`,
		status,
		evidenceProviderIds: ["qualification"],
		supersededReason: null,
		successorContract: null,
	}));

function closeoutFixture() {
	return {
		schemaVersion: 1,
		planningBaselineCommit: commit,
		changeSetBaseCommit: commit,
		implementationCommit: commit,
		startedAt: timestamp,
		completedAt: timestamp,
		runnerVersion: "scanner-hardening-closeout-v1",
		scope: {
			schemaVersion: 1,
			changeSetBaseCommit: commit,
			planningBaselineCommit: commit,
			candidateCommit: commit,
			contractHash: digest,
			baselineChangeCount: 78,
			residualChangeCount: 1,
			scannerPathCount: 64,
			separatePathCount: 15,
			generatedPathCount: 1,
			baselineMismatches: [],
			unknownPaths: [],
			missingRequiredPaths: [],
			scannerScopeDigest: digest,
			separateScopeDigest: digest,
			generatedScopeDigest: digest,
			cleanCheckout: true,
			ok: true,
		},
		commands: [
			{
				id: "scope",
				argv: ["bun", "run", "scope"],
				startedAt: timestamp,
				completedAt: timestamp,
				exitCode: 0,
				stdout: file("logs/scope.stdout.log"),
				stderr: file("logs/scope.stderr.log"),
			},
		],
		evidence: {
			applicationCommit: commit,
			targetCommit: commit,
			targetSnapshotSha256: digest,
			toolboxImageDigest: digest,
			scannerContractHash: digest,
			individual: file("evidence/evidence.v2.json"),
			repeat: file("evidence/evidence-repeat.v2.json"),
			fullProfile: file("evidence/full-profile.v1.json"),
			failure: file("evidence/failure.v1.json"),
			qualification: file("evidence/qualification.v2.json"),
			ciReceipt: null,
			reviewedBaselineSha256: digest,
			fullProfilePlanHash: digest,
			fullProfileNormalizedEvidenceHash: digest,
			canonicalFinalReportHashes: Object.fromEntries(
				Array.from({ length: 14 }, (_, index) => [`report-${index}`, digest]),
			),
			scopeReport: file("scope.v1.json"),
		},
		dod: results("SH-DOD", 17),
		remediation: results("RE-DOD", 21),
		remediationCases: results("A", 10),
		parentCloseout: results("SH-CLOSE", 4),
		ciPromotion: {
			status: "blocked",
			reason: "target_source_unavailable",
			verifiedCommit: null,
			verifyRunId: null,
			verifyConclusion: null,
			scannerE2ERunId: null,
			scannerE2EConclusion: null,
			ciReceiptSha256: null,
			branchProtectionConfirmed: false,
		},
		cleanup: {
			activeOwnedProcessCount: 0,
			activeOwnedContainerCount: 0,
			activeOwnedListenerCount: 0,
			targetHeadUnchanged: true,
			targetStatusUnchanged: true,
			productionDatabaseUnchanged: true,
			productionArtifactRootUnchanged: true,
		},
		verdict: "blocked",
	};
}

describe("scanner hardening receipt schemas", () => {
	test("accepts an explicitly blocked local receipt", () => {
		expect(scannerHardeningCloseoutReceiptSchema.parse(closeoutFixture()).verdict).toBe(
			"blocked",
		);
	});

	test("rejects a false pass while CI promotion remains unresolved", () => {
		expect(() =>
			scannerHardeningCloseoutReceiptSchema.parse({
				...closeoutFixture(),
				verdict: "passed",
			}),
		).toThrow("verdict");
	});

	test("rejects receipt path escapes", () => {
		const fixture = closeoutFixture();
		expect(() =>
			scannerHardeningCloseoutReceiptSchema.parse({
				...fixture,
				evidence: {
					...fixture.evidence,
					individual: file("../outside.json"),
				},
			}),
		).toThrow("receipt directory");
	});

	test("requires two distinct protected job identities", () => {
		const duplicate = {
			schemaVersion: 1,
			repository: "owner/repository",
			workflow: "verify",
			createdAt: timestamp,
			runId: "123",
			runAttempt: 1,
			applicationCommit: commit,
			requiredJobs: [
				{ id: "verify / verify", conclusion: "success" },
				{ id: "verify / verify", conclusion: "success" },
			],
			target: { repository: "todolist", commit, snapshotSha256: digest },
			toolboxImageDigest: digest,
			qualificationHash: digest,
			files: Array.from({ length: 5 }, (_, index) => file(`file-${index}.json`)),
			branchProtectionEvidence: null,
			branchProtectionConfirmed: false,
			verdict: "candidate",
		};
		expect(() => scannerHardeningCiReceiptSchema.parse(duplicate)).toThrow();
	});
});
