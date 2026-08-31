import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { runGitText } from "../api/modules/scans/git-command";
import { scannerE2EQualificationV2Schema } from "../shared/schemas/scanner-e2e-qualification-v2.schema";
import { scannerHardeningCloseoutReceiptSchema } from "../shared/schemas/scanner-hardening-receipt.schema";
import { todolistScannerBaselineSchema } from "../shared/schemas/todolist-scanner-baseline.schema";
import { canonicalJson, sha256 } from "./scanner-e2e-case-registry";
import { verifyScannerHardeningCiReceipt } from "./verify-scanner-hardening-ci-receipt";
import {
	type CLOSEOUT_COMMAND_IDS,
	closeoutReceiptArgv,
} from "./verify-scanner-hardening-closeout";
import { verifyScannerHardeningDod } from "./verify-scanner-hardening-dod";

const REPOSITORY_ROOT = path.resolve(import.meta.dir, "..");
const DEFAULT_CLOSEOUT_COMMAND_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_CLOSEOUT_COMMAND_LOG_BYTES = 32 * 1024 * 1024;

type CommandResult = {
	id: (typeof CLOSEOUT_COMMAND_IDS)[number];
	argv: string[];
	startedAt: string;
	completedAt: string;
	exitCode: number;
	stdout: Uint8Array;
	stderr: Uint8Array;
	forwarded?: boolean;
};

let activeChild: { kill(signal?: number | NodeJS.Signals): void } | null = null;
let interruptionSignal: "SIGINT" | "SIGTERM" | null = null;

export async function runScannerHardeningCloseout(params: {
	implementationCommit: string;
	outputRoot: string;
	ciReceiptPath?: string;
	targetRoot?: string;
	execute?: (id: CommandResult["id"], argv: string[]) => Promise<CommandResult>;
	now?: () => Date;
}) {
	const now = params.now ?? (() => new Date());
	const targetRoot = path.resolve(
		params.targetRoot ??
			process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH ??
			path.resolve(REPOSITORY_ROOT, "../todolist"),
	);
	interruptionSignal = null;
	const head = await gitText(REPOSITORY_ROOT, ["rev-parse", "HEAD"]);
	if (
		!/^([a-f0-9]{40})$/.test(params.implementationCommit) ||
		head !== params.implementationCommit
	) {
		throw new Error("scanner_hardening_closeout_commit_mismatch");
	}
	if (await gitText(REPOSITORY_ROOT, ["status", "--porcelain=v1"])) {
		throw new Error("scanner_hardening_closeout_dirty_checkout");
	}
	const resolvedCiReceiptPath = params.ciReceiptPath
		? path.resolve(params.ciReceiptPath)
		: null;
	const ciReceipt = resolvedCiReceiptPath
		? await verifyScannerHardeningCiReceipt({
				receiptPath: resolvedCiReceiptPath,
				expectedCommit: head,
				requireProtected: true,
			})
		: null;
	const startedAt = now().toISOString();
	const runId = `${startedAt.replaceAll(/[:.]/g, "-")}-${head.slice(0, 12)}`;
	const outputRoot = path.resolve(params.outputRoot);
	await fs.mkdir(outputRoot, { recursive: true });
	const runRoot = path.resolve(outputRoot, runId);
	await fs.mkdir(runRoot, { recursive: false });
	const before = await captureMutationState(targetRoot);
	const failurePath = path.join(runRoot, "failure.v1.json");
	const scopePath = path.join(runRoot, "scope.v1.json");
	const commandSpecs: Array<[CommandResult["id"], string[]]> = [
		[
			"scope",
			[
				"bun",
				"run",
				"scripts/check-scanner-hardening-closeout-scope.ts",
				"--candidate",
				head,
				"--out",
				scopePath,
			],
		],
		["scanner-e2e", ["bun", "run", "test:scanner-e2e"]],
		[
			"failure",
			["bun", "run", "scripts/scanner-e2e-failure.ts", "--out", failurePath],
		],
		[
			"failure-verify",
			[
				"bun",
				"run",
				"scripts/verify-scanner-e2e-failure-evidence.ts",
				"--evidence",
				failurePath,
				"--expected-commit",
				head,
			],
		],
		["verify-strict", ["bun", "run", "verify:strict"]],
		[
			"evidence-verify",
			[
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
				head,
			],
		],
		[
			"baseline-verify",
			[
				"bun",
				"run",
				"scripts/verify-todolist-scanner-baseline.ts",
				"--evidence",
				"artifacts/scanner-e2e/evidence.v2.json",
			],
		],
		["dod-verify", ["bun", "run", "scripts/verify-scanner-hardening-dod.ts"]],
	];
	const commandResults: CommandResult[] = [];
	for (const [id, argv] of commandSpecs) {
		const result = params.execute
			? await params.execute(id, argv)
			: await execute(id, argv);
		commandResults.push(result);
		await writeCommandLogs(runRoot, result);
		if (!result.forwarded) {
			process.stdout.write(result.stdout);
			process.stderr.write(result.stderr);
		}
		if (result.exitCode !== 0 || interruptionSignal) {
			const failedState = await captureMutationState(targetRoot);
			await cleanupNewOwnedResources(before, failedState);
			const cleanedState = await captureMutationState(targetRoot);
			if (
				before.targetHead !== cleanedState.targetHead ||
				before.targetStatus !== cleanedState.targetStatus ||
				before.database !== cleanedState.database ||
				before.artifactRoot !== cleanedState.artifactRoot ||
				newEntries(before.processIds, cleanedState.processIds).length !== 0 ||
				newEntries(before.containerNames, cleanedState.containerNames)
					.length !== 0 ||
				newEntries(before.listenerPaths, cleanedState.listenerPaths).length !==
					0
			) {
				throw new Error("scanner_hardening_closeout_failed_cleanup_invalid");
			}
			if (interruptionSignal) {
				throw new Error("scanner_hardening_closeout_interrupted");
			}
			throw new Error(`scanner_hardening_closeout_command_failed:${id}`);
		}
	}
	if (interruptionSignal) {
		throw new Error("scanner_hardening_closeout_interrupted");
	}
	const after = await captureMutationState(targetRoot);
	const activeOwnedProcessCount = newEntries(
		before.processIds,
		after.processIds,
	).length;
	const activeOwnedContainerCount = newEntries(
		before.containerNames,
		after.containerNames,
	).length;
	const activeOwnedListenerCount = newEntries(
		before.listenerPaths,
		after.listenerPaths,
	).length;
	if (
		activeOwnedProcessCount !== 0 ||
		activeOwnedContainerCount !== 0 ||
		activeOwnedListenerCount !== 0
	) {
		await cleanupNewOwnedResources(before, after);
		throw new Error("scanner_hardening_closeout_resource_leak");
	}
	if (
		before.targetHead !== after.targetHead ||
		before.targetStatus !== after.targetStatus ||
		before.database !== after.database ||
		before.artifactRoot !== after.artifactRoot
	) {
		throw new Error("scanner_hardening_closeout_mutation_detected");
	}
	const evidenceRoot = path.join(runRoot, "evidence");
	await fs.mkdir(evidenceRoot);
	for (const fileName of [
		"evidence.v2.json",
		"evidence-repeat.v2.json",
		"full-profile.v1.json",
		"qualification.v2.json",
	]) {
		await writeExclusiveCopy(
			path.resolve(REPOSITORY_ROOT, "artifacts/scanner-e2e", fileName),
			path.join(evidenceRoot, fileName),
		);
	}
	await fs.copyFile(failurePath, path.join(evidenceRoot, "failure.v1.json"));
	await fs.cp(
		path.join(runRoot, "failure-logs"),
		path.join(evidenceRoot, "failure-logs"),
		{ recursive: true, errorOnExist: true, force: false },
	);
	let copiedCiReceiptPath: string | null = null;
	if (ciReceipt && resolvedCiReceiptPath) {
		const sourceRoot = path.dirname(resolvedCiReceiptPath);
		const ciEvidenceRoot = path.join(runRoot, "ci-evidence");
		await fs.mkdir(ciEvidenceRoot);
		for (const entry of ciReceipt.files) {
			await writeExclusiveCopy(
				path.resolve(sourceRoot, entry.path),
				path.join(ciEvidenceRoot, entry.path),
			);
		}
		copiedCiReceiptPath = "ci-evidence/ci-receipt.v1.json";
		await writeExclusiveCopy(
			resolvedCiReceiptPath,
			path.join(runRoot, copiedCiReceiptPath),
		);
	}
	const evidencePaths = {
		individual: "evidence/evidence.v2.json",
		repeat: "evidence/evidence-repeat.v2.json",
		fullProfile: "evidence/full-profile.v1.json",
		failure: "evidence/failure.v1.json",
		qualification: "evidence/qualification.v2.json",
	};
	const [scope, qualification, baseline, dodContracts] = await Promise.all([
		fs.readFile(scopePath, "utf8").then((raw) => JSON.parse(raw)),
		fs
			.readFile(path.join(evidenceRoot, "qualification.v2.json"), "utf8")
			.then((raw) => scannerE2EQualificationV2Schema.parse(JSON.parse(raw))),
		fs
			.readFile(
				path.resolve(
					REPOSITORY_ROOT,
					"spec/security-capability/todolist-scanner-baseline.v1.json",
				),
				"utf8",
			)
			.then((raw) => todolistScannerBaselineSchema.parse(JSON.parse(raw))),
		loadDodContract(),
	]);
	if (
		ciReceipt &&
		(ciReceipt.qualificationHash !== qualification.qualificationHash ||
			ciReceipt.target.commit !== qualification.target.commit ||
			ciReceipt.target.snapshotSha256 !== qualification.target.snapshotSha256 ||
			ciReceipt.toolboxImageDigest !== qualification.toolboxImageDigest)
	) {
		throw new Error("scanner_hardening_closeout_ci_qualification_mismatch");
	}
	const ciPromotion = ciReceipt
		? {
				status: "passed" as const,
				reason: null,
				verifiedCommit: ciReceipt.applicationCommit,
				verifyRunId: ciReceipt.runId,
				verifyConclusion: "success" as const,
				scannerE2ERunId: ciReceipt.runId,
				scannerE2EConclusion: "success" as const,
				ciReceiptSha256: await digestFile(
					requireCiReceiptPath(resolvedCiReceiptPath),
				),
				branchProtectionConfirmed: true,
			}
		: {
				status: "blocked" as const,
				reason: "protected_ci_receipt_missing",
				verifiedCommit: null,
				verifyRunId: null,
				verifyConclusion: null,
				scannerE2ERunId: null,
				scannerE2EConclusion: null,
				ciReceiptSha256: null,
				branchProtectionConfirmed: false,
			};
	const receipt = scannerHardeningCloseoutReceiptSchema.parse({
		schemaVersion: 1,
		planningBaselineCommit: scope.planningBaselineCommit,
		changeSetBaseCommit: scope.changeSetBaseCommit,
		implementationCommit: head,
		startedAt,
		completedAt: now().toISOString(),
		runnerVersion: "scanner-hardening-closeout-v1",
		scope,
		commands: await Promise.all(
			commandResults.map(async (result) => ({
				id: result.id,
				argv: closeoutReceiptArgv(result.id, head),
				startedAt: result.startedAt,
				completedAt: result.completedAt,
				exitCode: result.exitCode,
				stdout: await fileRef(runRoot, `logs/${result.id}.stdout.log`),
				stderr: await fileRef(runRoot, `logs/${result.id}.stderr.log`),
			})),
		),
		evidence: {
			applicationCommit: qualification.applicationCommit,
			targetCommit: qualification.target.commit,
			targetSnapshotSha256: qualification.target.snapshotSha256,
			toolboxImageDigest: qualification.toolboxImageDigest,
			scannerContractHash: qualification.contractHash,
			individual: await fileRef(runRoot, evidencePaths.individual),
			repeat: await fileRef(runRoot, evidencePaths.repeat),
			fullProfile: await fileRef(runRoot, evidencePaths.fullProfile),
			failure: await fileRef(runRoot, evidencePaths.failure),
			qualification: await fileRef(runRoot, evidencePaths.qualification),
			ciReceipt: copiedCiReceiptPath
				? await fileRef(runRoot, copiedCiReceiptPath)
				: null,
			reviewedBaselineSha256: sha256(canonicalJson(baseline)),
			fullProfilePlanHash: qualification.fullProfileExecutionPlanHash,
			fullProfileNormalizedEvidenceHash:
				qualification.fullProfileNormalizedEvidenceHash,
			canonicalFinalReportHashes: qualification.canonicalFinalReportHashes,
			scopeReport: await fileRef(runRoot, "scope.v1.json"),
		},
		dod: resultEntries(dodContracts.parentDod, ciPromotion.status),
		remediation: resultEntries(dodContracts.remediationDod, ciPromotion.status),
		remediationCases: resultEntries(
			dodContracts.remediationCases,
			ciPromotion.status,
		),
		parentCloseout: resultEntries(
			dodContracts.parentCloseout,
			ciPromotion.status,
		),
		ciPromotion,
		cleanup: {
			activeOwnedProcessCount,
			activeOwnedContainerCount,
			activeOwnedListenerCount,
			targetHeadUnchanged: before.targetHead === after.targetHead,
			targetStatusUnchanged: before.targetStatus === after.targetStatus,
			productionDatabaseUnchanged: before.database === after.database,
			productionArtifactRootUnchanged:
				before.artifactRoot === after.artifactRoot,
		},
		verdict: ciPromotion.status === "passed" ? "passed" : "blocked",
	});
	const receiptPath = path.join(runRoot, "receipt.json");
	await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
		flag: "wx",
	});
	return { receiptPath, receipt };
}

export async function executeCloseoutCommand(
	id: CommandResult["id"],
	argv: string[],
	options?: {
		cwd?: string;
		timeoutMs?: number;
		maxLogBytes?: number;
		forward?: boolean;
	},
) {
	const startedAt = new Date().toISOString();
	const [command] = argv;
	if (!command) throw new Error("scanner_hardening_closeout_command_empty");
	const timeoutMs = options?.timeoutMs ?? DEFAULT_CLOSEOUT_COMMAND_TIMEOUT_MS;
	const maxLogBytes =
		options?.maxLogBytes ?? DEFAULT_CLOSEOUT_COMMAND_LOG_BYTES;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
		throw new Error("scanner_hardening_closeout_timeout_invalid");
	}
	if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes < 128) {
		throw new Error("scanner_hardening_closeout_log_limit_invalid");
	}
	const captureRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "vwb-closeout-command-"),
	);
	const stdoutPath = path.join(captureRoot, "stdout");
	const stderrPath = path.join(captureRoot, "stderr");
	const child = spawn(
		"/bin/sh",
		[
			"-c",
			'stdout_path=$1; stderr_path=$2; shift 2; exec "$@" >"$stdout_path" 2>"$stderr_path"',
			"vwb-closeout-command",
			stdoutPath,
			stderrPath,
			...argv,
		],
		{
			cwd: options?.cwd ?? REPOSITORY_ROOT,
			stdio: "ignore",
			env: process.env,
		},
	);
	activeChild = child;
	let terminationReason: "timeout" | "output_limit" | null = null;
	let spawnErrorMessage: string | null = null;
	let childClosed = false;
	let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
	const terminate = (reason: "timeout" | "output_limit") => {
		if (terminationReason) return;
		terminationReason = reason;
		if (childClosed) return;
		child.kill("SIGTERM");
		forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
		forceKillTimer.unref();
	};
	const timeout = setTimeout(() => terminate("timeout"), timeoutMs);
	let stdoutOffset = 0;
	let stderrOffset = 0;
	let forwardedBytes = 0;
	const forwardFile = async (
		filePath: string,
		stream: "stdout" | "stderr",
		destination: NodeJS.WriteStream,
	) => {
		const bytes = await fs
			.readFile(filePath)
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return Buffer.alloc(0);
				throw error;
			});
		const offset = stream === "stdout" ? stdoutOffset : stderrOffset;
		if (bytes.length <= offset) return;
		const available = Math.max(0, maxLogBytes - forwardedBytes);
		const retained = bytes.subarray(offset, offset + available);
		if (retained.length > 0) {
			if (options?.forward !== false) destination.write(retained);
			forwardedBytes += retained.length;
		}
		if (stream === "stdout") stdoutOffset = bytes.length;
		else stderrOffset = bytes.length;
		if (retained.length !== bytes.length - offset) terminate("output_limit");
	};
	let flushPromise = Promise.resolve();
	const scheduleFlush = () => {
		flushPromise = flushPromise.then(async () => {
			await forwardFile(stdoutPath, "stdout", process.stdout);
			await forwardFile(stderrPath, "stderr", process.stderr);
		});
	};
	const outputMonitor = setInterval(scheduleFlush, 100);
	outputMonitor.unref();
	const completion = new Promise<number>((resolve) => {
		child.once("error", (error) => {
			spawnErrorMessage = error.message;
			resolve(126);
		});
		child.once("close", (code) => {
			childClosed = true;
			resolve(code ?? 1);
		});
	});
	const childExitCode = await completion.finally(() => {
		clearTimeout(timeout);
		clearInterval(outputMonitor);
		if (forceKillTimer) clearTimeout(forceKillTimer);
		activeChild = null;
	});
	scheduleFlush();
	await flushPromise;
	const [rawStdout, rawStderr] = await Promise.all([
		fs.readFile(stdoutPath).catch(() => Buffer.alloc(0)),
		fs.readFile(stderrPath).catch(() => Buffer.alloc(0)),
	]);
	if (rawStdout.length + rawStderr.length > maxLogBytes) {
		terminate("output_limit");
	}
	const diagnostic = terminationReason
		? `scanner_hardening_closeout_${terminationReason}\n`
		: spawnErrorMessage
			? `scanner_hardening_closeout_spawn_failed:${spawnErrorMessage}\n`
			: "";
	const diagnosticBytes = Buffer.from(diagnostic);
	const contentBudget = Math.max(0, maxLogBytes - diagnosticBytes.length);
	const stdout = rawStdout.subarray(0, contentBudget);
	const capturedStderr = rawStderr.subarray(
		0,
		Math.max(0, contentBudget - stdout.length),
	);
	await fs.rm(captureRoot, { recursive: true, force: true });
	if (diagnostic && options?.forward !== false)
		process.stderr.write(diagnostic);
	const stderr = diagnostic
		? Buffer.concat([capturedStderr, diagnosticBytes])
		: capturedStderr;
	const exitCode = terminationReason
		? terminationReason === "timeout"
			? 124
			: 125
		: childExitCode;
	return {
		id,
		argv,
		startedAt,
		completedAt: new Date().toISOString(),
		exitCode,
		stdout,
		stderr,
		forwarded: options?.forward !== false,
	};
}

async function execute(id: CommandResult["id"], argv: string[]) {
	return executeCloseoutCommand(id, argv);
}

async function writeCommandLogs(root: string, result: CommandResult) {
	const logs = path.join(root, "logs");
	await fs.mkdir(logs, { recursive: true });
	await Promise.all([
		fs.writeFile(path.join(logs, `${result.id}.stdout.log`), result.stdout, {
			flag: "wx",
		}),
		fs.writeFile(path.join(logs, `${result.id}.stderr.log`), result.stderr, {
			flag: "wx",
		}),
	]);
}

async function fileRef(root: string, relative: string) {
	const bytes = await fs.readFile(path.join(root, relative));
	return {
		path: relative,
		sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
		sizeBytes: bytes.length,
	};
}

async function digestFile(filePath: string) {
	const bytes = await fs.readFile(filePath);
	return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function requireCiReceiptPath(value: string | null): string {
	if (!value) throw new Error("scanner_hardening_closeout_ci_receipt_missing");
	return value;
}

async function writeExclusiveCopy(source: string, destination: string) {
	const bytes = await fs.readFile(source);
	await fs.mkdir(path.dirname(destination), { recursive: true });
	await fs.writeFile(destination, bytes, { flag: "wx" });
}

async function captureMutationState(targetRoot: string) {
	const processLines = await ownedProcessLines();
	const processIds = ownedProcessIds(processLines);
	const listenerPaths = ownedListenerPaths(processLines);
	const containerNames = await ownedContainerNames();
	return {
		targetHead: await gitText(targetRoot, ["rev-parse", "HEAD"]),
		targetStatus: await gitText(targetRoot, [
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
		]),
		database: await treeDigest(path.resolve(REPOSITORY_ROOT, "data")),
		artifactRoot: await treeDigest(
			path.resolve(REPOSITORY_ROOT, "artifacts/scans"),
		),
		processIds,
		containerNames,
		listenerPaths,
	};
}

async function treeDigest(root: string) {
	const entries: Array<{ path: string; size: number; sha256: string }> = [];
	async function visit(directory: string) {
		const children = await fs
			.readdir(directory, { withFileTypes: true })
			.catch(() => []);
		for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
			const childPath = path.join(directory, child.name);
			if (child.isSymbolicLink())
				throw new Error("closeout_mutation_path_symlink");
			if (child.isDirectory()) await visit(childPath);
			if (child.isFile()) {
				const bytes = await fs.readFile(childPath);
				entries.push({
					path: path.relative(root, childPath),
					size: bytes.length,
					sha256: sha256(bytes.toString("base64")),
				});
			}
		}
	}
	await visit(root);
	return sha256(canonicalJson(entries));
}

async function ownedContainerNames() {
	const result = await executeCloseoutCommand(
		"scope",
		["docker", "ps", "--format", "{{.Names}}"],
		{
			timeoutMs: 30_000,
			maxLogBytes: 1024 * 1024,
			forward: false,
		},
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`closeout_container_cleanup_probe_failed:${Buffer.from(result.stderr).toString("utf8").trim()}`,
		);
	}
	return Buffer.from(result.stdout)
		.toString("utf8")
		.split("\n")
		.filter((name) =>
			/^(?:vwb-scanner-e2e|vwb-e2e-trivy-cache|vwb-todolist-target)/.test(name),
		)
		.sort();
}

function ownedProcessIds(lines: string[]) {
	return lines
		.map((line) => Number.parseInt(line, 10))
		.filter((pid) => Number.isSafeInteger(pid) && pid !== process.pid)
		.sort((left, right) => left - right);
}

async function ownedProcessLines() {
	const result = await executeCloseoutCommand(
		"scope",
		["ps", "-axo", "pid=,command="],
		{
			timeoutMs: 30_000,
			maxLogBytes: 8 * 1024 * 1024,
			forward: false,
		},
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`closeout_process_cleanup_probe_failed:${Buffer.from(result.stderr).toString("utf8").trim()}`,
		);
	}
	return Buffer.from(result.stdout)
		.toString("utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(
			(line) =>
				line.includes(REPOSITORY_ROOT) &&
				/(?:api\/cli\/sqlite-writer\.ts|scripts\/scanner-e2e(?:-failure)?\.ts)/.test(
					line,
				),
		);
}

function ownedListenerPaths(lines: string[]) {
	const paths = lines.flatMap((line) => {
		const match = /(?:^|\s)--socket\s+([^\s]+)/.exec(line);
		return match?.[1] ? [path.resolve(match[1])] : [];
	});
	return [...new Set(paths)].sort();
}

function newEntries<T>(before: T[], after: T[]) {
	const existing = new Set(before);
	return after.filter((entry) => !existing.has(entry));
}

async function cleanupNewOwnedResources(
	before: Awaited<ReturnType<typeof captureMutationState>>,
	after: Awaited<ReturnType<typeof captureMutationState>>,
) {
	for (const pid of newEntries(before.processIds, after.processIds)) {
		try {
			process.kill(pid, "SIGTERM");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
	}
	if (newEntries(before.processIds, after.processIds).length > 0) {
		await Bun.sleep(100);
		for (const pid of newEntries(before.processIds, after.processIds)) {
			try {
				process.kill(pid, 0);
				process.kill(pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		}
	}
	for (const name of newEntries(before.containerNames, after.containerNames)) {
		const result = await executeCloseoutCommand(
			"scope",
			["docker", "rm", "-f", name],
			{
				timeoutMs: 30_000,
				maxLogBytes: 1024 * 1024,
				forward: false,
			},
		);
		if (result.exitCode !== 0) {
			throw new Error(
				`scanner_hardening_closeout_container_cleanup_failed:${name}:${Buffer.from(result.stderr).toString("utf8").trim()}`,
			);
		}
	}
	for (const listenerPath of newEntries(
		before.listenerPaths,
		after.listenerPaths,
	)) {
		await fs.unlink(listenerPath).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
}

async function gitText(root: string, argv: string[]) {
	try {
		return (await runGitText({ cwd: root, args: argv })).trim();
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr;
		throw new Error(`closeout_git_failed:${stderr?.trim() ?? ""}`);
	}
}

async function loadDodContract() {
	await verifyScannerHardeningDod();
	return JSON.parse(
		await fs.readFile(
			path.resolve(
				REPOSITORY_ROOT,
				"spec/security-capability/scanner-hardening-dod.v1.json",
			),
			"utf8",
		),
	) as Record<string, ContractEntry[]>;
}

type ContractEntry = {
	id: string;
	requiredProviderIds: string[];
	disposition?: "passed" | "superseded";
};

function resultEntries(entries: ContractEntry[], ciStatus: string) {
	return entries.map((entry) => {
		const superseded = entry.disposition === "superseded";
		return {
			id: entry.id,
			status: superseded
				? "superseded"
				: entry.requiredProviderIds.includes("ci-receipt") &&
						ciStatus !== "passed"
					? "blocked"
					: "passed",
			evidenceProviderIds: entry.requiredProviderIds,
			supersededReason: superseded
				? "real_scan_target_fixed_to_todolist"
				: null,
			successorContract: superseded
				? "spec/security-capability/todolist-scan-target.v1.json"
				: null,
		};
	});
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			"implementation-commit": { type: "string" },
			"ci-receipt": { type: "string" },
			out: { type: "string" },
		},
		strict: true,
	}).values;
	if (!args["implementation-commit"] || !args.out) {
		throw new Error("scanner_hardening_closeout_args_required");
	}
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			interruptionSignal = signal;
			activeChild?.kill(signal);
		});
	}
	const result = await runScannerHardeningCloseout({
		implementationCommit: args["implementation-commit"],
		outputRoot: args.out,
		ciReceiptPath: args["ci-receipt"],
	});
	console.log(
		JSON.stringify({
			receipt: result.receiptPath,
			verdict: result.receipt.verdict,
		}),
	);
	process.exitCode = result.receipt.verdict === "passed" ? 0 : 4;
}

export function scannerHardeningCloseoutExitCode(error: unknown): number {
	const message = error instanceof Error ? error.message : String(error);
	if (
		/(?:_args_required|_commit_mismatch|_ci_receipt_missing|_candidate_commit_invalid)/.test(
			message,
		)
	) {
		return 2;
	}
	if (
		/(?:dirty_checkout|command_failed:scope|scope_|generated_drift)/.test(
			message,
		)
	) {
		return 3;
	}
	if (/command_failed:scanner-e2e/.test(message)) return 5;
	if (/command_failed:(?:failure|failure-verify)/.test(message)) return 6;
	if (/(?:command_failed:verify-strict|interrupted)/.test(message)) return 7;
	if (/(?:cleanup|resource_leak|mutation)/.test(message)) return 8;
	if (/(?:receipt|digest_mismatch|qualification_mismatch)/.test(message))
		return 9;
	return 4;
}

if (import.meta.main) {
	await main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = scannerHardeningCloseoutExitCode(error);
	});
}
