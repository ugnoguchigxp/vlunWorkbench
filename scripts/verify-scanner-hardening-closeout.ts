import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { scannerE2EQualificationV2Schema } from "../shared/schemas/scanner-e2e-qualification-v2.schema";
import { runGitText } from "../api/modules/scans/git-command";
import {
	scannerHardeningCloseoutScopeContractSchema,
	scannerHardeningCloseoutScopeReportSchema,
} from "../shared/schemas/scanner-hardening-closeout.schema";
import {
	type ScannerHardeningCloseoutReceipt,
	scannerHardeningCloseoutReceiptSchema,
} from "../shared/schemas/scanner-hardening-receipt.schema";
import { todolistScannerBaselineSchema } from "../shared/schemas/todolist-scanner-baseline.schema";
import { canonicalJson } from "./scanner-e2e-case-registry";
import { checkScannerHardeningCloseoutScope } from "./check-scanner-hardening-closeout-scope";
import { verifyScannerE2EFailureEvidence } from "./verify-scanner-e2e-failure-evidence";
import { verifyScannerE2EV2Qualification } from "./verify-scanner-e2e-v2-qualification";
import { verifyScannerHardeningCiReceipt } from "./verify-scanner-hardening-ci-receipt";
import { verifyScannerHardeningDod } from "./verify-scanner-hardening-dod";
import { verifyTodolistScannerBaseline } from "./verify-todolist-scanner-baseline";

export const CLOSEOUT_COMMAND_IDS = [
	"scope",
	"scanner-e2e",
	"failure",
	"failure-verify",
	"verify-strict",
	"evidence-verify",
	"baseline-verify",
	"dod-verify",
] as const;

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "..");

export function closeoutReceiptArgv(
	id: (typeof CLOSEOUT_COMMAND_IDS)[number],
	implementationCommit: string,
): string[] {
	const commands: Record<(typeof CLOSEOUT_COMMAND_IDS)[number], string[]> = {
		scope: [
			"bun",
			"run",
			"scripts/check-scanner-hardening-closeout-scope.ts",
			"--candidate",
			implementationCommit,
			"--out",
			"$RUN_ROOT/scope.v1.json",
		],
		"scanner-e2e": ["bun", "run", "test:scanner-e2e"],
		failure: [
			"bun",
			"run",
			"scripts/scanner-e2e-failure.ts",
			"--out",
			"$RUN_ROOT/failure.v1.json",
		],
		"failure-verify": [
			"bun",
			"run",
			"scripts/verify-scanner-e2e-failure-evidence.ts",
			"--evidence",
			"$RUN_ROOT/failure.v1.json",
			"--expected-commit",
			implementationCommit,
		],
		"verify-strict": ["bun", "run", "verify:strict"],
		"evidence-verify": [
			"bun",
			"run",
			"scripts/verify-scanner-e2e-v2-qualification.ts",
			"--qualification",
			"artifacts/scanner-e2e/qualification.v2.json",
			"--evidence",
			"artifacts/scanner-e2e/evidence.v2.json",
			"--repeat-evidence",
			"artifacts/scanner-e2e/evidence-repeat.v2.json",
			"--full-profile-evidence",
			"artifacts/scanner-e2e/full-profile.v1.json",
			"--expected-commit",
			implementationCommit,
		],
		"baseline-verify": [
			"bun",
			"run",
			"scripts/verify-todolist-scanner-baseline.ts",
			"--evidence",
			"artifacts/scanner-e2e/evidence.v2.json",
		],
		"dod-verify": ["bun", "run", "scripts/verify-scanner-hardening-dod.ts"],
	};
	return commands[id];
}

export async function verifyScannerHardeningCloseout(params: {
	receiptPath: string;
	allowBlocked?: boolean;
}) {
	const receiptPath = path.resolve(params.receiptPath);
	const receipt = scannerHardeningCloseoutReceiptSchema.parse(
		JSON.parse(await fs.readFile(receiptPath, "utf8")),
	);
	const root = path.dirname(receiptPath);
	assertExactIds(
		receipt.commands.map((entry) => entry.id),
		[...CLOSEOUT_COMMAND_IDS],
		"scanner_hardening_closeout_command_set_mismatch",
	);
	for (const command of receipt.commands) {
		if (
			canonicalJson(command.argv) !==
			canonicalJson(
				closeoutReceiptArgv(
					command.id as (typeof CLOSEOUT_COMMAND_IDS)[number],
					receipt.implementationCommit,
				),
			)
		) {
			throw new Error(
				`scanner_hardening_closeout_command_argv_mismatch:${command.id}`,
			);
		}
	}
	if (receipt.commands.some((entry) => entry.exitCode !== 0)) {
		throw new Error("scanner_hardening_closeout_command_failed");
	}
	await Promise.all(
		receipt.commands.flatMap((entry) => [
			verifyFile(root, entry.stdout),
			verifyFile(root, entry.stderr),
		]),
	);
	await verifyFile(root, receipt.evidence.scopeReport);
	await verifyScopeBinding(root, receipt);
	await Promise.all(
		Object.values({
			individual: receipt.evidence.individual,
			repeat: receipt.evidence.repeat,
			fullProfile: receipt.evidence.fullProfile,
			failure: receipt.evidence.failure,
			qualification: receipt.evidence.qualification,
		}).map((entry) => verifyFile(root, entry)),
	);
	const qualification = scannerE2EQualificationV2Schema.parse(
		JSON.parse(
			await fs.readFile(
				resolveContained(root, receipt.evidence.qualification.path),
				"utf8",
			),
		),
	);
	const baseline = todolistScannerBaselineSchema.parse(
		JSON.parse(
			await fs.readFile(
				path.join(
					REPOSITORY_ROOT,
					"spec/security-capability/todolist-scanner-baseline.v1.json",
				),
				"utf8",
			),
		),
	);
	const baselineDigest = `sha256:${crypto
		.createHash("sha256")
		.update(canonicalJson(baseline))
		.digest("hex")}`;
	if (baselineDigest !== receipt.evidence.reviewedBaselineSha256) {
		throw new Error("scanner_hardening_closeout_baseline_digest_mismatch");
	}
	if (receipt.evidence.ciReceipt) {
		await verifyFile(root, receipt.evidence.ciReceipt);
		if (
			receipt.evidence.ciReceipt.sha256 !== receipt.ciPromotion.ciReceiptSha256
		) {
			throw new Error("scanner_hardening_closeout_ci_receipt_digest_mismatch");
		}
		const ciReceipt = await verifyScannerHardeningCiReceipt({
			receiptPath: resolveContained(root, receipt.evidence.ciReceipt.path),
			expectedCommit: receipt.implementationCommit,
			requireProtected: true,
		});
		if (
			ciReceipt.runId !== receipt.ciPromotion.verifyRunId ||
			ciReceipt.runId !== receipt.ciPromotion.scannerE2ERunId ||
			ciReceipt.qualificationHash !== qualification.qualificationHash ||
			ciReceipt.target.commit !== receipt.evidence.targetCommit ||
			ciReceipt.target.snapshotSha256 !==
				receipt.evidence.targetSnapshotSha256 ||
			ciReceipt.toolboxImageDigest !== receipt.evidence.toolboxImageDigest
		) {
			throw new Error("scanner_hardening_closeout_ci_receipt_binding_mismatch");
		}
	}
	await Promise.all([
		verifyScannerE2EV2Qualification({
			qualificationPath: resolveContained(
				root,
				receipt.evidence.qualification.path,
			),
			evidencePath: resolveContained(root, receipt.evidence.individual.path),
			repeatEvidencePath: resolveContained(root, receipt.evidence.repeat.path),
			fullProfileEvidencePath: resolveContained(
				root,
				receipt.evidence.fullProfile.path,
			),
			expectedApplicationCommit: receipt.implementationCommit,
		}),
		verifyScannerE2EFailureEvidence({
			evidencePath: resolveContained(root, receipt.evidence.failure.path),
			expectedCommit: receipt.implementationCommit,
		}),
		verifyTodolistScannerBaseline({
			evidencePath: resolveContained(root, receipt.evidence.individual.path),
		}),
	]);
	if (
		qualification.applicationCommit !== receipt.implementationCommit ||
		receipt.evidence.applicationCommit !== receipt.implementationCommit ||
		qualification.target.commit !== receipt.evidence.targetCommit ||
		qualification.target.snapshotSha256 !==
			receipt.evidence.targetSnapshotSha256 ||
		qualification.toolboxImageDigest !== receipt.evidence.toolboxImageDigest ||
		qualification.contractHash !== receipt.evidence.scannerContractHash ||
		qualification.fullProfileExecutionPlanHash !==
			receipt.evidence.fullProfilePlanHash ||
		qualification.fullProfileNormalizedEvidenceHash !==
			receipt.evidence.fullProfileNormalizedEvidenceHash ||
		canonicalJson(qualification.canonicalFinalReportHashes) !==
			canonicalJson(receipt.evidence.canonicalFinalReportHashes)
	) {
		throw new Error("scanner_hardening_closeout_qualification_mismatch");
	}
	const contracts = await loadDodContracts();
	assertResults(
		receipt.dod,
		contracts.parentDod,
		receipt.ciPromotion.status,
		false,
	);
	assertResults(
		receipt.parentCloseout,
		contracts.parentCloseout,
		receipt.ciPromotion.status,
		false,
	);
	assertResults(
		receipt.remediation,
		contracts.remediationDod,
		receipt.ciPromotion.status,
		false,
	);
	assertResults(
		receipt.remediationCases,
		contracts.remediationCases,
		receipt.ciPromotion.status,
		true,
	);
	const cleanupPassed =
		receipt.cleanup.activeOwnedProcessCount === 0 &&
		receipt.cleanup.activeOwnedContainerCount === 0 &&
		receipt.cleanup.activeOwnedListenerCount === 0 &&
		receipt.cleanup.targetHeadUnchanged &&
		receipt.cleanup.targetStatusUnchanged &&
		receipt.cleanup.productionDatabaseUnchanged &&
		receipt.cleanup.productionArtifactRootUnchanged;
	if (!cleanupPassed)
		throw new Error("scanner_hardening_closeout_cleanup_failed");
	const hasFailed = [
		...receipt.dod,
		...receipt.parentCloseout,
		...receipt.remediation,
		...receipt.remediationCases,
	].some((entry) => entry.status === "failed");
	const promotable =
		!hasFailed &&
		receipt.ciPromotion.status === "passed" &&
		receipt.ciPromotion.branchProtectionConfirmed &&
		receipt.verdict === "passed";
	if (receipt.verdict === "passed" && !promotable) {
		throw new Error("scanner_hardening_closeout_false_pass");
	}
	if (receipt.verdict === "failed") {
		throw new Error("scanner_hardening_closeout_failed_receipt");
	}
	if (!promotable && !params.allowBlocked) {
		throw new Error("scanner_hardening_closeout_not_promotable");
	}
	return { receipt, promotable };
}

async function loadDodContracts() {
	await verifyScannerHardeningDod();
	const raw = await fs.readFile(
		path.resolve(
			import.meta.dir,
			"../spec/security-capability/scanner-hardening-dod.v1.json",
		),
		"utf8",
	);
	return JSON.parse(raw) as {
		parentDod: ContractResult[];
		parentCloseout: ContractResult[];
		remediationDod: ContractResult[];
		remediationCases: Array<ContractResult & { disposition: string }>;
	};
}

type ContractResult = { id: string; requiredProviderIds: string[] };

function assertResults(
	actual: ScannerHardeningCloseoutReceipt["dod"],
	expected: Array<ContractResult & { disposition?: string }>,
	ciStatus: string,
	allowSuperseded: boolean,
) {
	assertExactIds(
		actual.map((entry) => entry.id),
		expected.map((entry) => entry.id),
		"scanner_hardening_closeout_result_set_mismatch",
	);
	for (const contract of expected) {
		const result = actual.find((entry) => entry.id === contract.id);
		if (!result) {
			throw new Error(
				`scanner_hardening_closeout_result_missing:${contract.id}`,
			);
		}
		assertExactIds(
			result.evidenceProviderIds,
			contract.requiredProviderIds,
			`scanner_hardening_closeout_provider_mismatch:${contract.id}`,
		);
		const needsCi = contract.requiredProviderIds.includes("ci-receipt");
		const expectedStatus =
			allowSuperseded && contract.disposition === "superseded"
				? "superseded"
				: needsCi && ciStatus !== "passed"
					? "blocked"
					: "passed";
		if (result.status !== expectedStatus) {
			throw new Error(
				`scanner_hardening_closeout_status_invalid:${contract.id}`,
			);
		}
		if (expectedStatus === "superseded") {
			if (
				result.supersededReason !== "real_scan_target_fixed_to_todolist" ||
				result.successorContract !==
					"spec/security-capability/todolist-scan-target.v1.json"
			) {
				throw new Error(
					`scanner_hardening_closeout_supersession_invalid:${contract.id}`,
				);
			}
		} else if (
			result.supersededReason !== null ||
			result.successorContract !== null
		) {
			throw new Error(
				`scanner_hardening_closeout_unexpected_supersession:${contract.id}`,
			);
		}
	}
}

export function assertExactIds(
	actual: string[],
	expected: string[],
	code: string,
) {
	if (
		actual.length !== expected.length ||
		new Set(actual).size !== expected.length ||
		expected.some((id, index) => actual[index] !== id)
	) {
		throw new Error(code);
	}
}

async function verifyFile(
	root: string,
	entry: { path: string; sha256: string; sizeBytes: number },
) {
	const bytes = await readRegularContainedFile(root, entry.path);
	const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
	if (digest !== entry.sha256 || bytes.length !== entry.sizeBytes) {
		throw new Error(`scanner_hardening_closeout_file_invalid:${entry.path}`);
	}
}

async function verifyScopeBinding(
	root: string,
	receipt: ScannerHardeningCloseoutReceipt,
) {
	const recorded = scannerHardeningCloseoutScopeReportSchema.parse(
		JSON.parse(
			(
				await readRegularContainedFile(root, receipt.evidence.scopeReport.path)
			).toString("utf8"),
		),
	);
	if (canonicalJson(recorded) !== canonicalJson(receipt.scope)) {
		throw new Error("scanner_hardening_closeout_scope_report_mismatch");
	}
	const head = (
		await runGitText({ cwd: REPOSITORY_ROOT, args: ["rev-parse", "HEAD"] })
	).trim();
	if (head !== receipt.implementationCommit) {
		throw new Error("scanner_hardening_closeout_verifier_commit_mismatch");
	}
	const contract = scannerHardeningCloseoutScopeContractSchema.parse(
		JSON.parse(
			await fs.readFile(
				path.join(
					REPOSITORY_ROOT,
					"spec/security-capability/scanner-hardening-closeout-scope.v1.json",
				),
				"utf8",
			),
		),
	);
	const recalculated = await checkScannerHardeningCloseoutScope({
		repositoryRoot: REPOSITORY_ROOT,
		contract,
		candidate: receipt.implementationCommit,
	});
	if (
		!recalculated.ok ||
		canonicalJson(recalculated) !== canonicalJson(recorded)
	) {
		throw new Error("scanner_hardening_closeout_scope_recalculation_mismatch");
	}
}

async function readRegularContainedFile(root: string, relativePath: string) {
	const resolvedRoot = await fs.realpath(path.resolve(root));
	const resolved = resolveContained(root, relativePath);
	const fileStat = await fs.lstat(resolved);
	if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
		throw new Error("scanner_hardening_closeout_file_not_regular");
	}
	const realFile = await fs.realpath(resolved);
	const relative = path.relative(resolvedRoot, realFile);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("scanner_hardening_closeout_path_escape");
	}
	return await fs.readFile(realFile);
}

export function resolveContained(root: string, relativePath: string) {
	const resolvedRoot = path.resolve(root);
	const resolved = path.resolve(resolvedRoot, relativePath);
	const relative = path.relative(resolvedRoot, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("scanner_hardening_closeout_path_escape");
	}
	return resolved;
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			receipt: { type: "string" },
			"allow-blocked": { type: "boolean", default: false },
		},
		strict: true,
	}).values;
	if (!args.receipt)
		throw new Error("scanner_hardening_closeout_receipt_required");
	const verified = await verifyScannerHardeningCloseout({
		receiptPath: args.receipt,
		allowBlocked: args["allow-blocked"],
	});
	console.log(JSON.stringify({ ok: true, promotable: verified.promotable }));
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 9;
	});
}
