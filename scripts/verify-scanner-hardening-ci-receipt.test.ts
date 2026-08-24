import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScannerE2EQualificationV2 } from "../shared/schemas/scanner-e2e-qualification-v2.schema";
import { scannerHardeningCiReceiptSchema } from "../shared/schemas/scanner-hardening-receipt.schema";
import { buildScannerHardeningCiReceipt } from "./build-scanner-hardening-ci-receipt";
import { buildBranchProtectionEvidence } from "./capture-scanner-hardening-branch-protection";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";

const roots: string[] = [];
const COMMIT = "b".repeat(40);
const DIGEST = `sha256:${"a".repeat(64)}`;
const CAPTURED_AT = "2026-08-21T00:00:00.000Z";
const captureTime = () => new Date(CAPTURED_AT);
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
] as ScannerE2EQualificationV2["caseAssertionIds"][string];

afterAll(async () => {
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("scanner hardening CI receipt", () => {
	test("promotes only after both jobs succeed on a protected ref", async () => {
		const root = await artifactRoot();
		const branchProtectionEvidencePath = await writeBranchProtectionEvidence(root);
		const receipt = await buildScannerHardeningCiReceipt({
			artifactRoot: root,
			outputPath: path.join(root, "ci-receipt.v1.json"),
			repository: "owner/vulnWorkbench",
			runId: "1234",
			runAttempt: 1,
			applicationCommit: COMMIT,
			verifyConclusion: "success",
			scannerE2EConclusion: "success",
			branchProtectionEvidencePath,
			triggerRef: "refs/heads/main",
			now: captureTime,
		});
		expect(receipt.verdict).toBe("passed");
		expect(receipt.branchProtectionConfirmed).toBe(true);
		expect(receipt.requiredJobs.map((entry) => entry.id).sort()).toEqual([
			"scanner-e2e-real / scanner-e2e-real",
			"verify / verify",
		]);
	});

	test("keeps pull-request evidence as a non-promotable candidate", async () => {
		const root = await artifactRoot();
		const receipt = await buildScannerHardeningCiReceipt({
			artifactRoot: root,
			outputPath: path.join(root, "ci-receipt.v1.json"),
			repository: "owner/vulnWorkbench",
			runId: "5678",
			runAttempt: 2,
			applicationCommit: COMMIT,
			verifyConclusion: "success",
			scannerE2EConclusion: "success",
		});
		expect(receipt).toMatchObject({
			verdict: "candidate",
			branchProtectionConfirmed: false,
		});
	});

	test("rejects a fabricated job success or inconsistent promotion verdict", async () => {
		const root = await artifactRoot();
		await expect(
			buildScannerHardeningCiReceipt({
				artifactRoot: root,
				outputPath: path.join(root, "ci-receipt.v1.json"),
				repository: "owner/vulnWorkbench",
				runId: "9012",
				runAttempt: 1,
				applicationCommit: COMMIT,
				verifyConclusion: "failure",
				scannerE2EConclusion: "success",
			}),
		).rejects.toThrow("scanner_hardening_ci_required_job_not_successful");
		const rootForCandidate = await artifactRoot();
		const candidate = await buildScannerHardeningCiReceipt({
			artifactRoot: rootForCandidate,
			outputPath: path.join(rootForCandidate, "ci-receipt.v1.json"),
			repository: "owner/vulnWorkbench",
			runId: "3456",
			runAttempt: 1,
			applicationCommit: COMMIT,
			verifyConclusion: "success",
			scannerE2EConclusion: "success",
		});
		expect(() =>
			scannerHardeningCiReceiptSchema.parse({
				...candidate,
				branchProtectionConfirmed: true,
			}),
		).toThrow();
	});

	test("rejects protection evidence without both exact required checks", () => {
		expect(() =>
			buildBranchProtectionEvidence({
				repository: "owner/vulnWorkbench",
				branchName: "main",
				branchResponse: {
					name: "main",
					protected: true,
					protection: {
						required_status_checks: { contexts: ["verify / verify"] },
					},
				},
				rulesResponse: [],
				capturedAt: CAPTURED_AT,
			}),
		).toThrow();
	});

	test("rejects replayed branch-protection evidence", async () => {
		const root = await artifactRoot();
		const branchProtectionEvidencePath = await writeBranchProtectionEvidence(root);
		await expect(
			buildScannerHardeningCiReceipt({
				artifactRoot: root,
				outputPath: path.join(root, "ci-receipt.v1.json"),
				repository: "owner/vulnWorkbench",
				runId: "7777",
				runAttempt: 1,
				applicationCommit: COMMIT,
				verifyConclusion: "success",
				scannerE2EConclusion: "success",
				branchProtectionEvidencePath,
				triggerRef: "refs/heads/main",
				now: () => new Date("2026-08-21T01:00:00.000Z"),
			}),
		).rejects.toThrow("branch_protection_stale");
	});
});

async function writeBranchProtectionEvidence(root: string) {
	const outputPath = path.join(root, "branch-protection.v1.json");
	const evidence = buildBranchProtectionEvidence({
		repository: "owner/vulnWorkbench",
		branchName: "main",
		branchResponse: {
			name: "main",
			protected: true,
			protection: {
				required_status_checks: { contexts: ["verify / verify"] },
			},
		},
		rulesResponse: [
			{
				type: "required_status_checks",
				parameters: {
					required_status_checks: [
						{ context: "scanner-e2e-real / scanner-e2e-real" },
					],
				},
			},
		],
		capturedAt: CAPTURED_AT,
	});
	await fs.writeFile(outputPath, JSON.stringify(evidence));
	return outputPath;
}

async function artifactRoot() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-ci-receipt-"));
	roots.push(root);
	const qualification = qualificationFixture();
	await Promise.all([
		fs.writeFile(
			path.join(root, "qualification.v2.json"),
			JSON.stringify(qualification),
		),
		...[
			"evidence.v2.json",
			"evidence-repeat.v2.json",
			"full-profile.v1.json",
			"failure.v1.json",
		].map((name) => fs.writeFile(path.join(root, name), `${name}\n`)),
	]);
	return root;
}

function qualificationFixture(): ScannerE2EQualificationV2 {
	const unsigned = {
		schemaVersion: 2 as const,
		contractHash: DIGEST,
		qualifiedAt: "2026-08-21T00:00:00.000Z",
		applicationCommit: COMMIT,
		target: {
			repository: "todolist" as const,
			commit: "c".repeat(40),
			snapshotSha256: DIGEST,
		},
		toolboxImageDigest: DIGEST,
		scannerManifestHash: DIGEST,
		executionHash: DIGEST,
		caseEvidenceHashes: Object.fromEntries(CASE_IDS.map((id) => [id, DIGEST])),
		caseScannerIdentityHashes: Object.fromEntries(
			CASE_IDS.map((id) => [id, DIGEST]),
		),
		caseAssertionIds: Object.fromEntries(
			CASE_IDS.map((id) => [
				id,
				id === "schemathesis-not-applicable"
					? ASSERTIONS.filter(
							(assertion) =>
								!["PROV-01", "WORK-01", "ART-01", "NORM-01"].includes(
									assertion,
								),
							)
					: ASSERTIONS,
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
