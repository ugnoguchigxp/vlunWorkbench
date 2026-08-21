import { afterEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	buildScannerE2EFailureEvidence,
	loadScannerE2EFailureContract,
} from "./scanner-e2e-failure";
import { assertScannerE2EFailureEvidence } from "./verify-scanner-e2e-failure-evidence";

const roots: string[] = [];
const COMMIT = "a".repeat(40);

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

test("builds and verifies the exact FI-01..FI-11 evidence set", async () => {
	const { contract, contractHash } = await loadScannerE2EFailureContract();
	const evidence = await buildScannerE2EFailureEvidence({
		contract,
		contractHash,
		applicationCommit: COMMIT,
		generatedAt: "2026-08-21T00:00:00.000Z",
		execute: async () => ({
			exitCode: 0,
			stdout: new TextEncoder().encode("pass"),
			stderr: new Uint8Array(),
		}),
		persistOutput: async (caseId, result) => outputReferences(caseId, result),
		observe: async (caseId) =>
			contract.cases.find((entry) => entry.id === caseId)!.expected,
	});
	expect(evidence.cases.map((entry) => entry.caseId)).toEqual(
		contract.cases.map((entry) => entry.id),
	);
	expect(
		assertScannerE2EFailureEvidence({
			contract,
			contractHash,
			evidence,
			expectedCommit: COMMIT,
		}),
	).toMatchObject({ applicationCommit: COMMIT, caseCount: 11 });
});

test("stops without evidence when a focused failure test fails", async () => {
	const { contract, contractHash } = await loadScannerE2EFailureContract();
	await expect(
		buildScannerE2EFailureEvidence({
			contract,
			contractHash,
			applicationCommit: COMMIT,
			execute: async () => ({
				exitCode: 1,
				stdout: new Uint8Array(),
				stderr: new TextEncoder().encode("fail"),
			}),
			persistOutput: async (caseId, result) => outputReferences(caseId, result),
			observe: async (caseId) =>
				contract.cases.find((entry) => entry.id === caseId)!.expected,
		}),
	).rejects.toThrow("scanner_e2e_failure_case_failed:FI-01");
});

test("rejects a tampered observation and an application commit mismatch", async () => {
	const { contract, contractHash } = await loadScannerE2EFailureContract();
	const evidence = await buildScannerE2EFailureEvidence({
		contract,
		contractHash,
		applicationCommit: COMMIT,
		execute: async () => ({
			exitCode: 0,
			stdout: new Uint8Array(),
			stderr: new Uint8Array(),
		}),
		persistOutput: async (caseId, result) => outputReferences(caseId, result),
		observe: async (caseId) =>
			contract.cases.find((entry) => entry.id === caseId)!.expected,
	});
	const tampered = structuredClone(evidence);
	tampered.cases[0]!.observed.requestCount = 1;
	expect(() =>
		assertScannerE2EFailureEvidence({
			contract,
			contractHash,
			evidence: tampered,
		}),
	).toThrow("scanner_e2e_failure_observation_mismatch:FI-01");
	expect(() =>
		assertScannerE2EFailureEvidence({
			contract,
			contractHash,
			evidence,
			expectedCommit: "b".repeat(40),
		}),
	).toThrow("scanner_e2e_failure_application_commit_mismatch");
});

test("file verifier rejects duplicate case identities", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-failure-evidence-"));
	roots.push(root);
	const { contract, contractHash } = await loadScannerE2EFailureContract();
	const evidence = await buildScannerE2EFailureEvidence({
		contract,
		contractHash,
		applicationCommit: COMMIT,
		execute: async () => ({
			exitCode: 0,
			stdout: new Uint8Array(),
			stderr: new Uint8Array(),
		}),
		persistOutput: async (caseId, result) => outputReferences(caseId, result),
		observe: async (caseId) =>
			contract.cases.find((entry) => entry.id === caseId)!.expected,
	});
	evidence.cases[10] = structuredClone(evidence.cases[0]!);
	const evidencePath = path.join(root, "failure.v1.json");
	await fs.writeFile(evidencePath, JSON.stringify(evidence));
	const { verifyScannerE2EFailureEvidence } = await import(
		"./verify-scanner-e2e-failure-evidence"
	);
	await expect(
		verifyScannerE2EFailureEvidence({ evidencePath }),
	).rejects.toThrow("scanner_e2e_failure_duplicate_case");
});

test("file verifier recomputes focused-test output bytes", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-failure-output-"));
	roots.push(root);
	await fs.mkdir(path.join(root, "failure-logs"));
	const { contract, contractHash } = await loadScannerE2EFailureContract();
	const evidence = await buildScannerE2EFailureEvidence({
		contract,
		contractHash,
		applicationCommit: COMMIT,
		execute: async () => ({
			exitCode: 0,
			stdout: new TextEncoder().encode("focused pass"),
			stderr: new Uint8Array(),
		}),
		observe: async (caseId) =>
			contract.cases.find((entry) => entry.id === caseId)!.expected,
		persistOutput: async (caseId, result) => {
			const references = outputReferences(caseId, result);
			await Promise.all([
				fs.writeFile(path.join(root, references.stdout.path), result.stdout),
				fs.writeFile(path.join(root, references.stderr.path), result.stderr),
			]);
			return references;
		},
	});
	const evidencePath = path.join(root, "failure.v1.json");
	await fs.writeFile(evidencePath, JSON.stringify(evidence));
	const { verifyScannerE2EFailureEvidence } = await import(
		"./verify-scanner-e2e-failure-evidence"
	);
	await expect(
		verifyScannerE2EFailureEvidence({ evidencePath }),
	).resolves.toMatchObject({ caseCount: 11 });
	await fs.writeFile(path.join(root, evidence.cases[0]!.stdout.path), "tampered");
	await expect(
		verifyScannerE2EFailureEvidence({ evidencePath }),
	).rejects.toThrow("scanner_e2e_failure_output_digest_mismatch:failure-logs/FI-01.stdout.log");
});

function outputReferences(
	caseId: string,
	result: { stdout: Uint8Array; stderr: Uint8Array },
) {
	return {
		stdout: {
			path: `failure-logs/${caseId}.stdout.log`,
			sha256: digest(result.stdout),
			sizeBytes: result.stdout.length,
		},
		stderr: {
			path: `failure-logs/${caseId}.stderr.log`,
			sha256: digest(result.stderr),
			sizeBytes: result.stderr.length,
		},
	};
}

function digest(bytes: Uint8Array) {
	return `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;
}
