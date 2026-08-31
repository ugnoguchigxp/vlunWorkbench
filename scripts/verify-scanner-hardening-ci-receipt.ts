import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EQualificationV2Schema } from "../shared/schemas/scanner-e2e-qualification-v2.schema";
import {
	scannerHardeningBranchProtectionEvidenceSchema,
	scannerHardeningCiReceiptSchema,
} from "../shared/schemas/scanner-hardening-receipt.schema";
import { verifyScannerE2EFailureEvidence } from "./verify-scanner-e2e-failure-evidence";
import { verifyScannerE2EV2Qualification } from "./verify-scanner-e2e-v2-qualification";
import { verifyTodolistScannerBaseline } from "./verify-todolist-scanner-baseline";

const REQUIRED_FILES = [
	"evidence.v2.json",
	"evidence-repeat.v2.json",
	"full-profile.v1.json",
	"failure.v1.json",
	"qualification.v2.json",
];
const MAX_BRANCH_PROTECTION_CAPTURE_AGE_MS = 15 * 60 * 1000;

export async function verifyScannerHardeningCiReceipt(params: {
	receiptPath: string;
	expectedCommit?: string;
	requireProtected?: boolean;
}) {
	const receiptPath = path.resolve(params.receiptPath);
	const receipt = scannerHardeningCiReceiptSchema.parse(
		JSON.parse(await fs.readFile(receiptPath, "utf8")),
	);
	if (
		params.expectedCommit &&
		receipt.applicationCommit !== params.expectedCommit
	) {
		throw new Error("scanner_hardening_ci_receipt_commit_mismatch");
	}
	const root = path.dirname(receiptPath);
	assertRequiredFiles(
		receipt.files.map((entry) => entry.path),
		receipt.branchProtectionEvidence !== null,
	);
	for (const entry of receipt.files) {
		const bytes = await readRegularContainedCiFile(root, entry.path);
		const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
		if (digest !== entry.sha256 || bytes.length !== entry.sizeBytes) {
			throw new Error(
				`scanner_hardening_ci_receipt_file_invalid:${entry.path}`,
			);
		}
	}
	if (receipt.branchProtectionEvidence) {
		const evidence = scannerHardeningBranchProtectionEvidenceSchema.parse(
			JSON.parse(
				(
					await readRegularContainedCiFile(
						root,
						receipt.branchProtectionEvidence.path,
					)
				).toString("utf8"),
			),
		);
		if (evidence.repository !== receipt.repository) {
			throw new Error(
				"scanner_hardening_ci_receipt_branch_protection_mismatch",
			);
		}
		const captureAgeMs =
			Date.parse(receipt.createdAt) - Date.parse(evidence.capturedAt);
		if (
			captureAgeMs < 0 ||
			captureAgeMs > MAX_BRANCH_PROTECTION_CAPTURE_AGE_MS
		) {
			throw new Error("scanner_hardening_ci_receipt_branch_protection_stale");
		}
	}
	const qualification = scannerE2EQualificationV2Schema.parse(
		JSON.parse(
			await fs.readFile(path.join(root, "qualification.v2.json"), "utf8"),
		),
	);
	if (
		qualification.qualificationHash !== receipt.qualificationHash ||
		qualification.applicationCommit !== receipt.applicationCommit ||
		qualification.target.commit !== receipt.target.commit ||
		qualification.target.snapshotSha256 !== receipt.target.snapshotSha256 ||
		qualification.toolboxImageDigest !== receipt.toolboxImageDigest
	) {
		throw new Error("scanner_hardening_ci_receipt_qualification_mismatch");
	}
	await Promise.all([
		verifyScannerE2EV2Qualification({
			qualificationPath: path.join(root, "qualification.v2.json"),
			evidencePath: path.join(root, "evidence.v2.json"),
			repeatEvidencePath: path.join(root, "evidence-repeat.v2.json"),
			fullProfileEvidencePath: path.join(root, "full-profile.v1.json"),
			expectedApplicationCommit: receipt.applicationCommit,
		}),
		verifyScannerE2EFailureEvidence({
			evidencePath: path.join(root, "failure.v1.json"),
			expectedCommit: receipt.applicationCommit,
		}),
		verifyTodolistScannerBaseline({
			evidencePath: path.join(root, "evidence.v2.json"),
		}),
	]);
	if (
		params.requireProtected &&
		(!receipt.branchProtectionConfirmed || receipt.verdict !== "passed")
	) {
		throw new Error("scanner_hardening_ci_receipt_protection_unconfirmed");
	}
	return receipt;
}

export function assertRequiredFiles(
	fileNames: string[],
	hasBranchProtectionEvidence = false,
) {
	const expected = [
		...REQUIRED_FILES,
		...(hasBranchProtectionEvidence ? ["branch-protection.v1.json"] : []),
	];
	if (
		new Set(fileNames).size !== expected.length ||
		expected.some((name) => !fileNames.includes(name))
	) {
		throw new Error("scanner_hardening_ci_receipt_file_set_mismatch");
	}
}

export function resolveContainedCiPath(root: string, relativePath: string) {
	const resolvedRoot = path.resolve(root);
	const resolved = path.resolve(resolvedRoot, relativePath);
	const relative = path.relative(resolvedRoot, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("scanner_hardening_ci_receipt_path_escape");
	}
	return resolved;
}

async function readRegularContainedCiFile(root: string, relativePath: string) {
	const resolvedRoot = await fs.realpath(path.resolve(root));
	const resolved = resolveContainedCiPath(root, relativePath);
	const fileStat = await fs.lstat(resolved);
	if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
		throw new Error("scanner_hardening_ci_receipt_file_not_regular");
	}
	const realFile = await fs.realpath(resolved);
	const relative = path.relative(resolvedRoot, realFile);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("scanner_hardening_ci_receipt_path_escape");
	}
	return await fs.readFile(realFile);
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			receipt: { type: "string" },
			"expected-commit": { type: "string" },
			"require-protected": { type: "boolean", default: false },
		},
		strict: true,
	}).values;
	if (!args.receipt) throw new Error("scanner_hardening_ci_receipt_required");
	const receipt = await verifyScannerHardeningCiReceipt({
		receiptPath: args.receipt,
		expectedCommit: args["expected-commit"],
		requireProtected: args["require-protected"],
	});
	console.log(JSON.stringify({ ok: true, verdict: receipt.verdict }));
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
