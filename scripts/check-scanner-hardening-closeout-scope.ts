import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import {
	closeSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
} from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	inventoryEntryKey,
	type ScannerHardeningCloseoutScopeContract,
	type ScannerHardeningCloseoutScopeReport,
	type ScannerHardeningScopeInventoryEntry,
	scannerHardeningCloseoutScopeContractSchema,
	scannerHardeningCloseoutScopeReportSchema,
} from "../shared/schemas/scanner-hardening-closeout.schema";

type GitChange =
	| { status: "added" | "modified" | "deleted"; path: string }
	| {
			status: "renamed";
			previousPath: string;
			path: string;
			similarity: number;
	  };

type ScopeClassification = "scanner_hardening" | "separate_ui" | "generated";

export function parseGitNameStatusZ(output: string): GitChange[] {
	const fields = output.split("\0");
	if (fields.at(-1) === "") fields.pop();
	const changes: GitChange[] = [];
	for (let index = 0; index < fields.length; ) {
		const rawStatus = fields[index++];
		if (!rawStatus)
			throw new Error("scanner_hardening_scope_git_status_missing");
		if (/^[AMD]$/.test(rawStatus)) {
			const changedPath = fields[index++];
			if (!changedPath)
				throw new Error("scanner_hardening_scope_git_path_missing");
			changes.push({
				status:
					rawStatus === "A"
						? "added"
						: rawStatus === "M"
							? "modified"
							: "deleted",
				path: normalizeRepositoryPath(changedPath),
			});
			continue;
		}
		const renamed = /^R(\d{1,3})$/.exec(rawStatus);
		if (renamed) {
			const previousPath = fields[index++];
			const changedPath = fields[index++];
			if (!previousPath || !changedPath) {
				throw new Error("scanner_hardening_scope_git_rename_path_missing");
			}
			changes.push({
				status: "renamed",
				previousPath: normalizeRepositoryPath(previousPath),
				path: normalizeRepositoryPath(changedPath),
				similarity: Number.parseInt(renamed[1] ?? "", 10),
			});
			continue;
		}
		throw new Error(
			`scanner_hardening_scope_git_status_unsupported:${rawStatus}`,
		);
	}
	return changes;
}

export function matchesScopePattern(
	pattern: string,
	candidate: string,
): boolean {
	if (!pattern.endsWith("/**")) return pattern === candidate;
	const prefix = pattern.slice(0, -3);
	return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

export function compareBaselineInventory(
	contract: ScannerHardeningCloseoutScopeContract,
	actual: GitChange[],
): { missing: string[]; unexpected: string[] } {
	const expectedKeys = new Set(
		contract.baselineInventory.map(inventoryEntryKey),
	);
	const actualKeys = new Set(actual.map(gitChangeKey));
	return {
		missing: [...expectedKeys].filter((key) => !actualKeys.has(key)).sort(),
		unexpected: [...actualKeys].filter((key) => !expectedKeys.has(key)).sort(),
	};
}

export function classifyResidualChange(
	contract: ScannerHardeningCloseoutScopeContract,
	change: GitChange,
): ScopeClassification | "unknown" {
	const paths = gitChangePaths(change);
	if (
		paths.every((changedPath) =>
			contract.generatedPaths.some((entry) => entry.path === changedPath),
		)
	) {
		return "generated";
	}
	if (
		paths.some((changedPath) =>
			contract.excludedResidualPatterns.some((pattern) =>
				matchesScopePattern(pattern, changedPath),
			),
		)
	) {
		return "unknown";
	}
	if (
		paths.every((changedPath) =>
			contract.allowedResidualPatterns.some((pattern) =>
				matchesScopePattern(pattern, changedPath),
			),
		)
	) {
		return "scanner_hardening";
	}
	return "unknown";
}

export async function checkScannerHardeningCloseoutScope(params: {
	repositoryRoot: string;
	contract: ScannerHardeningCloseoutScopeContract;
	candidate?: string;
	allowDirty?: boolean;
}): Promise<ScannerHardeningCloseoutScopeReport> {
	const repositoryRoot = path.resolve(params.repositoryRoot);
	const contract = scannerHardeningCloseoutScopeContractSchema.parse(
		params.contract,
	);
	const candidateCommit = await resolveCommit(
		repositoryRoot,
		params.candidate ?? "HEAD",
	);
	await assertAncestor(
		repositoryRoot,
		contract.planningBaselineCommit,
		candidateCommit,
	);
	const [baseline, residual, worktreeStatus] = await Promise.all([
		readGitChanges(
			repositoryRoot,
			contract.changeSetBaseCommit,
			contract.planningBaselineCommit,
		),
		readGitChanges(
			repositoryRoot,
			contract.planningBaselineCommit,
			candidateCommit,
		),
		runGit(repositoryRoot, [
			"status",
			"--porcelain=v1",
			"--untracked-files=all",
		]),
	]);
	const baselineComparison = compareBaselineInventory(contract, baseline);
	const baselineMismatches = [
		...baselineComparison.missing.map((entry) => `missing:${entry}`),
		...baselineComparison.unexpected.map((entry) => `unexpected:${entry}`),
	].sort();
	const unknownPaths = new Set<string>();
	const residualClassifications = residual.map((change) => ({
		change,
		classification: classifyResidualChange(contract, change),
	}));
	for (const entry of residualClassifications) {
		if (entry.classification === "unknown") {
			for (const changedPath of gitChangePaths(entry.change)) {
				unknownPaths.add(changedPath);
			}
		}
	}
	const missingRequiredPaths: string[] = [];
	for (const requiredPath of contract.requiredResidualPaths) {
		if (
			!(await commitContainsPath(repositoryRoot, candidateCommit, requiredPath))
		) {
			missingRequiredPaths.push(requiredPath);
		}
	}
	const scannerPaths = scopePaths(
		contract,
		residualClassifications,
		"scanner_hardening",
	);
	const separatePaths = scopePaths(
		contract,
		residualClassifications,
		"separate_ui",
	);
	const generatedPaths = scopePaths(
		contract,
		residualClassifications,
		"generated",
	);
	const [scannerScopeDigest, separateScopeDigest, generatedScopeDigest] =
		await Promise.all([
			patchDigest(
				repositoryRoot,
				contract.changeSetBaseCommit,
				candidateCommit,
				scannerPaths,
			),
			patchDigest(
				repositoryRoot,
				contract.changeSetBaseCommit,
				candidateCommit,
				separatePaths,
			),
			patchDigest(
				repositoryRoot,
				contract.changeSetBaseCommit,
				candidateCommit,
				generatedPaths,
			),
		]);
	const cleanCheckout =
		worktreeStatus.stdout.toString("utf8").trim().length === 0;
	const report: ScannerHardeningCloseoutScopeReport = {
		schemaVersion: 1,
		changeSetBaseCommit: contract.changeSetBaseCommit,
		planningBaselineCommit: contract.planningBaselineCommit,
		candidateCommit,
		contractHash: sha256(canonicalJson(contract)),
		baselineChangeCount: baseline.length,
		residualChangeCount: residual.length,
		scannerPathCount: scannerPaths.length,
		separatePathCount: separatePaths.length,
		generatedPathCount: generatedPaths.length,
		baselineMismatches,
		unknownPaths: [...unknownPaths].sort(),
		missingRequiredPaths: missingRequiredPaths.sort(),
		scannerScopeDigest,
		separateScopeDigest,
		generatedScopeDigest,
		cleanCheckout,
		ok:
			baselineMismatches.length === 0 &&
			unknownPaths.size === 0 &&
			missingRequiredPaths.length === 0 &&
			(cleanCheckout || params.allowDirty === true),
	};
	return scannerHardeningCloseoutScopeReportSchema.parse(report);
}

function scopePaths(
	contract: ScannerHardeningCloseoutScopeContract,
	residual: Array<{
		change: GitChange;
		classification: ScopeClassification | "unknown";
	}>,
	classification: ScopeClassification,
): string[] {
	const baseline = contract.baselineInventory
		.filter((entry) => entry.classification === classification)
		.flatMap(inventoryPaths);
	const additions = residual
		.filter((entry) => entry.classification === classification)
		.flatMap((entry) => gitChangePaths(entry.change));
	return [...new Set([...baseline, ...additions])].sort();
}

function inventoryPaths(entry: ScannerHardeningScopeInventoryEntry): string[] {
	return entry.status === "renamed"
		? [entry.previousPath, entry.path]
		: [entry.path];
}

function gitChangePaths(change: GitChange): string[] {
	return change.status === "renamed"
		? [change.previousPath, change.path]
		: [change.path];
}

function gitChangeKey(change: GitChange): string {
	return change.status === "renamed"
		? `${change.status}:${change.previousPath}:${change.path}:${change.similarity}`
		: `${change.status}:${change.path}`;
}

function normalizeRepositoryPath(value: string): string {
	const normalized = value.replaceAll("\\", "/");
	if (
		normalized.startsWith("/") ||
		normalized.split("/").some((segment) => segment === "" || segment === "..")
	) {
		throw new Error("scanner_hardening_scope_git_path_invalid");
	}
	return normalized;
}

async function readGitChanges(
	repositoryRoot: string,
	baseCommit: string,
	candidateCommit: string,
): Promise<GitChange[]> {
	const result = await runGit(repositoryRoot, [
		"diff",
		"--name-status",
		"-z",
		"--find-renames",
		`${baseCommit}..${candidateCommit}`,
	]);
	return parseGitNameStatusZ(result.stdout.toString("utf8"));
}

async function resolveCommit(
	repositoryRoot: string,
	revision: string,
): Promise<string> {
	if (/^[a-f0-9]{40}$/.test(revision)) {
		const exists = await runGit(
			repositoryRoot,
			["cat-file", "-e", `${revision}^{commit}`],
			{ allowedExitCodes: [0, 1, 128] },
		);
		if (exists.exitCode !== 0) {
			throw new Error("scanner_hardening_scope_candidate_commit_missing");
		}
		return revision;
	}
	const result = await runGit(repositoryRoot, [
		"rev-parse",
		"--verify",
		`${revision}^{commit}`,
	]);
	const commit = result.stdout.toString("utf8").trim();
	if (!/^[a-f0-9]{40}$/.test(commit)) {
		throw new Error("scanner_hardening_scope_candidate_commit_invalid");
	}
	return commit;
}

async function assertAncestor(
	repositoryRoot: string,
	ancestor: string,
	candidate: string,
): Promise<void> {
	const result = await runGit(
		repositoryRoot,
		["merge-base", "--is-ancestor", ancestor, candidate],
		{ allowedExitCodes: [0, 1] },
	);
	if (result.exitCode !== 0) {
		throw new Error("scanner_hardening_scope_candidate_not_descendant");
	}
}

async function commitContainsPath(
	repositoryRoot: string,
	commit: string,
	repositoryPath: string,
): Promise<boolean> {
	const result = await runGit(
		repositoryRoot,
		["cat-file", "-e", `${commit}:${repositoryPath}`],
		{ allowedExitCodes: [0, 1, 128] },
	);
	return result.exitCode === 0;
}

async function patchDigest(
	repositoryRoot: string,
	baseCommit: string,
	candidateCommit: string,
	paths: string[],
): Promise<`sha256:${string}`> {
	if (paths.length === 0) return sha256("");
	const result = await runGit(repositoryRoot, [
		"diff",
		"--binary",
		"--no-ext-diff",
		`${baseCommit}..${candidateCommit}`,
		"--",
		...paths,
	]);
	return sha256(result.stdout);
}

async function runGit(
	repositoryRoot: string,
	args: string[],
	options: { allowedExitCodes?: number[] } = {},
): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
	const allowedExitCodes = options.allowedExitCodes ?? [0];
	const captureRoot = mkdtempSync(
		path.join(os.tmpdir(), "scanner-hardening-scope-git-"),
	);
	const stdoutPath = path.join(captureRoot, "stdout");
	const stderrPath = path.join(captureRoot, "stderr");
	const stdoutFd = openSync(stdoutPath, "w");
	const stderrFd = openSync(stderrPath, "w");
	try {
		const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
			stdio: ["ignore", stdoutFd, stderrFd],
		});
		closeSync(stdoutFd);
		closeSync(stderrFd);
		const stdout = readFileSync(stdoutPath);
		const stderr = readFileSync(stderrPath);
		if (result.error) throw result.error;
		const exitCode = result.status ?? -1;
		if (!allowedExitCodes.includes(exitCode)) {
			throw new Error(
				`scanner_hardening_scope_git_failed:${args[0] ?? "unknown"}:${stderr.toString("utf8").trim()}`,
			);
		}
		return { exitCode, stdout, stderr };
	} finally {
		try {
			closeSync(stdoutFd);
		} catch {}
		try {
			closeSync(stderrFd);
		} catch {}
		rmSync(captureRoot, { recursive: true, force: true });
	}
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function sha256(value: string | Uint8Array): `sha256:${string}` {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function main(): Promise<void> {
	try {
		const args = parseArgs({
			args: process.argv.slice(2).filter((argument) => argument !== "--"),
			options: {
				contract: { type: "string" },
				candidate: { type: "string" },
				repository: { type: "string" },
				out: { type: "string" },
				"allow-dirty": { type: "boolean", default: false },
			},
			strict: true,
		}).values;
		const repositoryRoot = path.resolve(
			args.repository ?? path.resolve(import.meta.dir, ".."),
		);
		const contractPath = path.resolve(
			args.contract ??
				path.join(
					repositoryRoot,
					"spec/security-capability/scanner-hardening-closeout-scope.v1.json",
				),
		);
		const contract = scannerHardeningCloseoutScopeContractSchema.parse(
			JSON.parse(await fs.readFile(contractPath, "utf8")),
		);
		const report = await checkScannerHardeningCloseoutScope({
			repositoryRoot,
			contract,
			candidate: args.candidate,
			allowDirty: args["allow-dirty"],
		});
		if (args.out) {
			const outputPath = path.resolve(args.out);
			await fs.mkdir(path.dirname(outputPath), { recursive: true });
			await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
				flag: "wx",
			});
		}
		console.log(JSON.stringify(report));
		if (!report.ok) process.exitCode = 3;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 2;
	}
}

if (import.meta.main) await main();
