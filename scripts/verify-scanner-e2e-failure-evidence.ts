import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	type ScannerE2EFailureContract,
	type ScannerE2EFailureEvidence,
	scannerE2EFailureEvidenceSchema,
} from "../shared/schemas/scanner-e2e-failure.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { loadScannerE2EFailureContract } from "./scanner-e2e-failure";

export function assertScannerE2EFailureEvidence(params: {
	contract: ScannerE2EFailureContract;
	contractHash: string;
	evidence: ScannerE2EFailureEvidence;
	expectedCommit?: string;
}) {
	const { contract, contractHash, evidence, expectedCommit } = params;
	if (evidence.contractHash !== contractHash) {
		throw new Error("scanner_e2e_failure_contract_mismatch");
	}
	if (expectedCommit && evidence.applicationCommit !== expectedCommit) {
		throw new Error("scanner_e2e_failure_application_commit_mismatch");
	}
	const byId = new Map(evidence.cases.map((entry) => [entry.caseId, entry]));
	if (byId.size !== evidence.cases.length) {
		throw new Error("scanner_e2e_failure_duplicate_case");
	}
	if (byId.size !== contract.cases.length) {
		throw new Error("scanner_e2e_failure_case_set_mismatch");
	}
	for (const expected of contract.cases) {
		const actual = byId.get(expected.id);
		if (!actual)
			throw new Error(`scanner_e2e_failure_case_missing:${expected.id}`);
		const expectedArgv = [
			"bun",
			"test",
			expected.testFile,
			"-t",
			expected.testNamePattern,
		];
		if (
			actual.productionEntryPoint !== expected.productionEntryPoint ||
			actual.injectionPoint !== expected.injection ||
			actual.testFile !== expected.testFile ||
			actual.testNamePattern !== expected.testNamePattern ||
			canonicalJson(actual.argv) !== canonicalJson(expectedArgv)
		) {
			throw new Error(
				`scanner_e2e_failure_test_binding_mismatch:${expected.id}`,
			);
		}
		if (canonicalJson(actual.observed) !== canonicalJson(expected.expected)) {
			throw new Error(
				`scanner_e2e_failure_observation_mismatch:${expected.id}`,
			);
		}
		assertFailClosedInvariants(expected.id, actual.observed);
	}
	return {
		applicationCommit: evidence.applicationCommit,
		contractHash,
		caseCount: evidence.cases.length,
		evidenceHash: sha256(canonicalJson(evidence)),
	};
}

function assertFailClosedInvariants(
	caseId: string,
	observed: ScannerE2EFailureEvidence["cases"][number]["observed"],
) {
	if (
		observed.automaticDownloadCount !== 0 ||
		observed.cleanupCount !== 0 ||
		observed.covered ||
		observed.canonicalFinalReportCount !== 0 ||
		observed.terminalRowCount !== 1
	) {
		throw new Error(`scanner_e2e_failure_fail_closed_invariant:${caseId}`);
	}
	if (
		observed.profileOutcome === "blocked" &&
		(observed.scannerProcessCount !== 0 || observed.toolRunCount !== 0)
	) {
		throw new Error(`scanner_e2e_failure_blocked_work_detected:${caseId}`);
	}
	if (caseId === "FI-06" && !observed.existingBytesUnchanged) {
		throw new Error("scanner_e2e_failure_artifact_overwrite_detected:FI-06");
	}
	if (caseId === "FI-11" && observed.terminalRowCount !== 1) {
		throw new Error("scanner_e2e_failure_terminal_race_invalid:FI-11");
	}
}

export async function verifyScannerE2EFailureEvidence(params: {
	evidencePath: string;
	contractPath?: string;
	expectedCommit?: string;
}) {
	const [{ contract, contractHash }, raw] = await Promise.all([
		loadScannerE2EFailureContract(params.contractPath),
		fs.readFile(params.evidencePath, "utf8"),
	]);
	const evidence = scannerE2EFailureEvidenceSchema.parse(JSON.parse(raw));
	const verified = assertScannerE2EFailureEvidence({
		contract,
		contractHash,
		evidence,
		expectedCommit: params.expectedCommit,
	});
	const evidenceRoot = path.dirname(path.resolve(params.evidencePath));
	await Promise.all(
		evidence.cases.flatMap((entry) => [
			verifyOutputReference(evidenceRoot, entry.stdout),
			verifyOutputReference(evidenceRoot, entry.stderr),
		]),
	);
	return verified;
}

async function verifyOutputReference(
	root: string,
	reference: { path: string; sha256: string; sizeBytes: number },
) {
	const resolved = path.resolve(root, reference.path);
	const relative = path.relative(root, resolved);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error("scanner_e2e_failure_output_path_escape");
	}
	const bytes = await fs.readFile(resolved);
	const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
	if (digest !== reference.sha256 || bytes.length !== reference.sizeBytes) {
		throw new Error(
			`scanner_e2e_failure_output_digest_mismatch:${reference.path}`,
		);
	}
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			evidence: { type: "string" },
			contract: { type: "string" },
			"expected-commit": { type: "string" },
		},
		strict: true,
	}).values;
	if (!args.evidence) throw new Error("scanner_e2e_failure_evidence_required");
	const verified = await verifyScannerE2EFailureEvidence({
		evidencePath: args.evidence,
		contractPath: args.contract,
		expectedCommit: args["expected-commit"],
	});
	console.log(JSON.stringify({ ok: true, ...verified }));
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
