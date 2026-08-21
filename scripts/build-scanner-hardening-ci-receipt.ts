import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EQualificationV2Schema } from "../shared/schemas/scanner-e2e-qualification-v2.schema";
import {
	scannerHardeningBranchProtectionEvidenceSchema,
	scannerHardeningCiReceiptSchema,
} from "../shared/schemas/scanner-hardening-receipt.schema";

const FILES = [
	"evidence.v2.json",
	"evidence-repeat.v2.json",
	"full-profile.v1.json",
	"failure.v1.json",
	"qualification.v2.json",
] as const;
const MAX_BRANCH_PROTECTION_CAPTURE_AGE_MS = 15 * 60 * 1000;

export async function buildScannerHardeningCiReceipt(params: {
	artifactRoot: string;
	outputPath: string;
	repository: string;
	runId: string;
	runAttempt: number;
	applicationCommit: string;
	verifyConclusion: string;
	scannerE2EConclusion: string;
	branchProtectionEvidencePath?: string;
	triggerRef?: string;
	now?: () => Date;
}) {
	if (
		params.verifyConclusion !== "success" ||
		params.scannerE2EConclusion !== "success"
	) {
		throw new Error("scanner_hardening_ci_required_job_not_successful");
	}
	const qualification = scannerE2EQualificationV2Schema.parse(
		JSON.parse(
			await fs.readFile(
				path.join(params.artifactRoot, "qualification.v2.json"),
				"utf8",
			),
		),
	);
	if (qualification.applicationCommit !== params.applicationCommit) {
		throw new Error("scanner_hardening_ci_receipt_commit_mismatch");
	}
	const branchProtectionEvidence = params.branchProtectionEvidencePath
		? scannerHardeningBranchProtectionEvidenceSchema.parse(
				JSON.parse(
					await fs.readFile(params.branchProtectionEvidencePath, "utf8"),
				),
			)
		: null;
	const createdAt = (params.now ?? (() => new Date()))().toISOString();
	if (
		branchProtectionEvidence &&
		(branchProtectionEvidence.repository !== params.repository ||
			branchProtectionEvidence.ref !== params.triggerRef)
	) {
		throw new Error("scanner_hardening_ci_branch_protection_mismatch");
	}
	if (branchProtectionEvidence) {
		const captureAgeMs =
			Date.parse(createdAt) - Date.parse(branchProtectionEvidence.capturedAt);
		if (
			captureAgeMs < 0 ||
			captureAgeMs > MAX_BRANCH_PROTECTION_CAPTURE_AGE_MS
		) {
			throw new Error("scanner_hardening_ci_branch_protection_stale");
		}
	}
	const branchProtectionReference = branchProtectionEvidence
		? await artifactFileReference(
				params.artifactRoot,
				params.branchProtectionEvidencePath ?? "",
			)
		: null;
	const receipt = scannerHardeningCiReceiptSchema.parse({
		schemaVersion: 1,
		repository: params.repository,
		workflow: "verify",
		createdAt,
		runId: params.runId,
		runAttempt: params.runAttempt,
		applicationCommit: params.applicationCommit,
		requiredJobs: [
			{ id: "verify / verify", conclusion: "success" },
			{ id: "scanner-e2e-real / scanner-e2e-real", conclusion: "success" },
		],
		target: qualification.target,
		toolboxImageDigest: qualification.toolboxImageDigest,
		qualificationHash: qualification.qualificationHash,
		files: [
			...(await Promise.all(
				FILES.map((name) =>
					artifactFileReference(
						params.artifactRoot,
						path.join(params.artifactRoot, name),
					),
				),
			)),
			...(branchProtectionReference ? [branchProtectionReference] : []),
		],
		branchProtectionEvidence: branchProtectionReference,
		branchProtectionConfirmed: branchProtectionEvidence !== null,
		verdict: branchProtectionEvidence ? "passed" : "candidate",
	});
	await fs.writeFile(
		params.outputPath,
		`${JSON.stringify(receipt, null, 2)}\n`,
		{
			flag: "wx",
		},
	);
	return receipt;
}

async function artifactFileReference(root: string, filePath: string) {
	const resolvedRoot = path.resolve(root);
	const resolved = path.resolve(filePath);
	const relative = path.relative(resolvedRoot, resolved);
	if (
		relative.startsWith("..") ||
		path.isAbsolute(relative) ||
		relative.includes("\\")
	) {
		throw new Error("scanner_hardening_ci_receipt_path_escape");
	}
	const bytes = await fs.readFile(resolved);
	return {
		path: relative,
		sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
		sizeBytes: bytes.length,
	};
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			root: { type: "string" },
			out: { type: "string" },
		},
		strict: true,
	}).values;
	if (!args.root || !args.out)
		throw new Error("scanner_hardening_ci_receipt_args_required");
	const repository = process.env.GITHUB_REPOSITORY;
	const runId = process.env.GITHUB_RUN_ID;
	const commit = process.env.GITHUB_SHA;
	const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
	const verifyConclusion = process.env.VWB_VERIFY_CONCLUSION;
	const scannerE2EConclusion = process.env.VWB_SCANNER_E2E_CONCLUSION;
	if (!repository || !runId || !commit || !Number.isInteger(attempt)) {
		throw new Error("scanner_hardening_ci_environment_missing");
	}
	if (!verifyConclusion || !scannerE2EConclusion) {
		throw new Error("scanner_hardening_ci_promotion_environment_missing");
	}
	const branchProtectionEvidencePath =
		process.env.VWB_BRANCH_PROTECTION_EVIDENCE;
	await buildScannerHardeningCiReceipt({
		artifactRoot: path.resolve(args.root),
		outputPath: path.resolve(args.out),
		repository,
		runId,
		runAttempt: attempt,
		applicationCommit: commit,
		verifyConclusion,
		scannerE2EConclusion,
		branchProtectionEvidencePath: branchProtectionEvidencePath
			? path.resolve(branchProtectionEvidencePath)
			: undefined,
		triggerRef: process.env.GITHUB_REF,
	});
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
