import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	type ScannerE2EFailureContract,
	type ScannerE2EFailureEvidence,
	scannerE2EFailureContractSchema,
	scannerE2EFailureEvidenceSchema,
} from "../shared/schemas/scanner-e2e-failure.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";

type CommandResult = {
	exitCode: number;
	stdout: Uint8Array;
	stderr: Uint8Array;
};
type CommandExecutor = (
	argv: string[],
	caseId: string,
) => Promise<CommandResult>;
type FailureObservation =
	ScannerE2EFailureContract["cases"][number]["expected"];
type OutputReferences = {
	stdout: { path: string; sha256: string; sizeBytes: number };
	stderr: { path: string; sha256: string; sizeBytes: number };
};

export async function loadScannerE2EFailureContract(
	contractPath = path.resolve(
		import.meta.dir,
		"../spec/security-capability/scanner-e2e-failure-cases.v1.json",
	),
) {
	const contract = scannerE2EFailureContractSchema.parse(
		JSON.parse(await fs.readFile(contractPath, "utf8")),
	);
	return { contract, contractHash: sha256(canonicalJson(contract)) };
}

export async function buildScannerE2EFailureEvidence(params: {
	contract: ScannerE2EFailureContract;
	contractHash: string;
	applicationCommit: string;
	execute: CommandExecutor;
	observe: (caseId: string) => Promise<FailureObservation>;
	persistOutput: (
		caseId: string,
		result: CommandResult,
	) => Promise<OutputReferences>;
	generatedAt?: string;
}): Promise<ScannerE2EFailureEvidence> {
	if (!/^[a-f0-9]{40}$/.test(params.applicationCommit)) {
		throw new Error("scanner_e2e_failure_application_commit_invalid");
	}
	const cases = [];
	for (const entry of params.contract.cases) {
		const argv = ["bun", "test", entry.testFile, "-t", entry.testNamePattern];
		const result = await params.execute(argv, entry.id);
		if (result.exitCode !== 0) {
			throw new Error(`scanner_e2e_failure_case_failed:${entry.id}`);
		}
		const observed = await params.observe(entry.id);
		if (canonicalJson(observed) !== canonicalJson(entry.expected)) {
			throw new Error(`scanner_e2e_failure_observation_mismatch:${entry.id}`);
		}
		const output = await params.persistOutput(entry.id, result);
		cases.push({
			caseId: entry.id,
			productionEntryPoint: entry.productionEntryPoint,
			injectionPoint: entry.injection,
			testFile: entry.testFile,
			testNamePattern: entry.testNamePattern,
			argv,
			exitCode: 0 as const,
			stdout: output.stdout,
			stderr: output.stderr,
			observed,
		});
	}
	return scannerE2EFailureEvidenceSchema.parse({
		schemaVersion: 1,
		applicationCommit: params.applicationCommit,
		contractHash: params.contractHash,
		generatedAt: params.generatedAt ?? new Date().toISOString(),
		cases,
	});
}

export async function runScannerE2EFailure(params: {
	contractPath?: string;
	outputPath: string;
	execute?: CommandExecutor;
}) {
	const outputPath = path.resolve(params.outputPath);
	const outputRoot = path.dirname(outputPath);
	const logRoot = path.join(outputRoot, "failure-logs");
	await fs.mkdir(outputRoot, { recursive: true });
	await fs.mkdir(logRoot, { recursive: false });
	const [{ contract, contractHash }, applicationCommit] = await Promise.all([
		loadScannerE2EFailureContract(params.contractPath),
		gitHead(),
	]);
	const observationRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "scanner-e2e-failure-"),
	);
	let evidence: ScannerE2EFailureEvidence;
	try {
		evidence = await buildScannerE2EFailureEvidence({
			contract,
			contractHash,
			applicationCommit,
			execute: async (argv, caseId) => {
				if (params.execute) return await params.execute(argv, caseId);
				return await executeCommand(argv, caseId, {
					SCANNER_E2E_FAILURE_CASE_ID: caseId,
					SCANNER_E2E_FAILURE_OBSERVATION_PATH: path.join(
						observationRoot,
						`${caseId}.jsonl`,
					),
				});
			},
			observe: async (caseId) =>
				await readAggregatedObservation(
					path.join(observationRoot, `${caseId}.jsonl`),
					caseId,
				),
			persistOutput: async (caseId, result) => {
				const stdoutRelative = `failure-logs/${caseId}.stdout.log`;
				const stderrRelative = `failure-logs/${caseId}.stderr.log`;
				await Promise.all([
					fs.writeFile(path.join(outputRoot, stdoutRelative), result.stdout, {
						flag: "wx",
					}),
					fs.writeFile(path.join(outputRoot, stderrRelative), result.stderr, {
						flag: "wx",
					}),
				]);
				return {
					stdout: outputReference(stdoutRelative, result.stdout),
					stderr: outputReference(stderrRelative, result.stderr),
				};
			},
		});
	} finally {
		await fs.rm(observationRoot, { recursive: true, force: true });
	}
	await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
		flag: "wx",
	});
	return evidence;
}

async function executeCommand(
	argv: string[],
	_caseId: string,
	extraEnv: Record<string, string> = {},
): Promise<CommandResult> {
	const child = Bun.spawn(argv, {
		cwd: path.resolve(import.meta.dir, ".."),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...processEnv(), ...extraEnv },
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).arrayBuffer(),
		new Response(child.stderr).arrayBuffer(),
		child.exited,
	]);
	return {
		exitCode,
		stdout: new Uint8Array(stdout),
		stderr: new Uint8Array(stderr),
	};
}

async function readAggregatedObservation(
	observationPath: string,
	caseId: string,
): Promise<FailureObservation> {
	const raw = await fs.readFile(observationPath, "utf8").catch(() => {
		throw new Error(`scanner_e2e_failure_observation_missing:${caseId}`);
	});
	const observations = raw
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as FailureObservation);
	if (observations.length === 0)
		throw new Error(`scanner_e2e_failure_observation_missing:${caseId}`);
	const outcomes = new Set(observations.map((entry) => entry.profileOutcome));
	if (outcomes.size !== 1)
		throw new Error(
			`scanner_e2e_failure_observation_outcome_conflict:${caseId}`,
		);
	const maximum = (key: keyof FailureObservation) =>
		Math.max(...observations.map((entry) => Number(entry[key])));
	return {
		profileOutcome: observations[0].profileOutcome,
		reasonCodes: [
			...new Set(observations.flatMap((entry) => entry.reasonCodes)),
		].sort(),
		scannerProcessCount: maximum("scannerProcessCount"),
		toolRunCount: maximum("toolRunCount"),
		requestCount: maximum("requestCount"),
		artifactCount: maximum("artifactCount"),
		canonicalFinalReportCount: maximum("canonicalFinalReportCount"),
		terminalRowCount: maximum("terminalRowCount"),
		cleanupCount: maximum("cleanupCount"),
		existingBytesUnchanged: observations.every(
			(entry) => entry.existingBytesUnchanged,
		),
		covered: observations.some((entry) => entry.covered),
		automaticDownloadCount: maximum("automaticDownloadCount"),
	};
}

async function gitHead() {
	const result = await executeCommand(["git", "rev-parse", "HEAD"], "git-head");
	const value = new TextDecoder().decode(result.stdout).trim();
	if (result.exitCode !== 0 || !/^[a-f0-9]{40}$/.test(value)) {
		throw new Error("scanner_e2e_failure_git_commit_unavailable");
	}
	return value;
}

function processEnv(): Record<string, string> {
	return Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

function digest(bytes: Uint8Array) {
	return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function outputReference(path: string, bytes: Uint8Array) {
	return { path, sha256: digest(bytes), sizeBytes: bytes.length };
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			contract: { type: "string" },
			out: { type: "string" },
		},
		strict: true,
	}).values;
	if (!args.out) throw new Error("scanner_e2e_failure_output_required");
	const evidence = await runScannerE2EFailure({
		contractPath: args.contract,
		outputPath: args.out,
	});
	console.log(JSON.stringify({ ok: true, caseCount: evidence.cases.length }));
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
