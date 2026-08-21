import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScannerHardeningCloseoutScopeContract } from "../shared/schemas/scanner-hardening-closeout.schema";
import { scannerHardeningCloseoutScopeContractSchema } from "../shared/schemas/scanner-hardening-closeout.schema";
import {
	checkScannerHardeningCloseoutScope,
	classifyResidualChange,
	compareBaselineInventory,
	matchesScopePattern,
	parseGitNameStatusZ,
} from "./check-scanner-hardening-closeout-scope";

const temporaryDirectories: string[] = [];

afterAll(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("scanner hardening closeout scope", () => {
	test("parses add, modify, delete, and rename name-status records", () => {
		expect(
			parseGitNameStatusZ(
				"A\0added.ts\0M\0modified.ts\0D\0deleted.ts\0R100\0old.ts\0new.ts\0",
			),
		).toEqual([
			{ status: "added", path: "added.ts" },
			{ status: "modified", path: "modified.ts" },
			{ status: "deleted", path: "deleted.ts" },
			{
				status: "renamed",
				previousPath: "old.ts",
				path: "new.ts",
				similarity: 100,
			},
		]);
	});

	test("matches only exact paths or bounded /** prefixes", () => {
		expect(matchesScopePattern("scripts/**", "scripts/check.ts")).toBe(true);
		expect(matchesScopePattern("scripts/**", "scripts-extra/check.ts")).toBe(
			false,
		);
		expect(matchesScopePattern("package.json", "package.json")).toBe(true);
		expect(matchesScopePattern("package.json", "nested/package.json")).toBe(
			false,
		);
	});

	test("rejects broad or escaping scope patterns", () => {
		const contract = contractFixture({
			changeSetBaseCommit: "a".repeat(40),
			planningBaselineCommit: "b".repeat(40),
		});
		expect(() =>
			scannerHardeningCloseoutScopeContractSchema.parse({
				...contract,
				allowedResidualPatterns: ["/**"],
			}),
		).toThrow();
		expect(() =>
			scannerHardeningCloseoutScopeContractSchema.parse({
				...contract,
				allowedResidualPatterns: ["../scripts/**"],
			}),
		).toThrow();
	});

	test("compares the exact reviewed baseline inventory", () => {
		const contract = contractFixture({
			changeSetBaseCommit: "a".repeat(40),
			planningBaselineCommit: "b".repeat(40),
		});
		expect(
			compareBaselineInventory(contract, [
				{ status: "modified", path: "api/modules/scans/example.ts" },
				{ status: "modified", path: "web/example.ts" },
			]),
		).toEqual({ missing: [], unexpected: [] });
	});

	test("classifies generated, allowed, and excluded residual changes", () => {
		const contract = contractFixture({
			changeSetBaseCommit: "a".repeat(40),
			planningBaselineCommit: "b".repeat(40),
		});
		expect(
			classifyResidualChange(contract, {
				status: "modified",
				path: "spec/generated/table.html",
			}),
		).toBe("generated");
		expect(
			classifyResidualChange(contract, {
				status: "added",
				path: "scripts/check.ts",
			}),
		).toBe("scanner_hardening");
		expect(
			classifyResidualChange(contract, {
				status: "modified",
				path: "web/new.ts",
			}),
		).toBe("unknown");
	});

	test("verifies commits, scope digests, required paths, and clean status", async () => {
		const repositoryRoot = await createRepository();
		const baseCommit = await revParse(repositoryRoot, "HEAD");
		await write(repositoryRoot, "api/modules/scans/example.ts", "planning\n");
		await write(repositoryRoot, "web/example.ts", "ui\n");
		await commitAll(repositoryRoot, "planning");
		const planningBaselineCommit = await revParse(repositoryRoot, "HEAD");
		await write(repositoryRoot, "scripts/check.ts", "export {};\n");
		await commitAll(repositoryRoot, "candidate");
		const candidateCommit = await revParse(repositoryRoot, "HEAD");
		if (new Set([baseCommit, planningBaselineCommit, candidateCommit]).size !== 3) {
			throw new Error(
				`test_commits_not_distinct:${JSON.stringify({ baseCommit, planningBaselineCommit, candidateCommit })}`,
			);
		}
		const contract = contractFixture({
			changeSetBaseCommit: baseCommit,
			planningBaselineCommit,
		});
		const report = await runScopeCli(repositoryRoot, contract, candidateCommit, 0);
		expect(report.ok).toBe(true);
		expect(report.cleanCheckout).toBe(true);
		expect(report.baselineChangeCount).toBe(2);
		expect(report.residualChangeCount).toBe(1);
		expect(report.scannerPathCount).toBe(2);
		expect(report.separatePathCount).toBe(1);
		expect(report.baselineMismatches).toEqual([]);
		expect(report.unknownPaths).toEqual([]);
		expect(report.missingRequiredPaths).toEqual([]);
		expect(report.scannerScopeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(report.separateScopeDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	test("fails closed for a new UI path and dirty checkout", async () => {
		const repositoryRoot = await createRepository();
		const baseCommit = await revParse(repositoryRoot, "HEAD");
		await write(repositoryRoot, "api/modules/scans/example.ts", "planning\n");
		await write(repositoryRoot, "web/example.ts", "ui\n");
		await commitAll(repositoryRoot, "planning");
		const planningBaselineCommit = await revParse(repositoryRoot, "HEAD");
		await write(repositoryRoot, "scripts/check.ts", "export {};\n");
		await write(repositoryRoot, "web/new.ts", "not allowed\n");
		await commitAll(repositoryRoot, "candidate");
		const candidateCommit = await revParse(repositoryRoot, "HEAD");
		await write(repositoryRoot, "dirty.txt", "dirty\n");
		const report = await runScopeCli(
			repositoryRoot,
			contractFixture({
				changeSetBaseCommit: baseCommit,
				planningBaselineCommit,
			}),
			candidateCommit,
			3,
		);
		expect(report.ok).toBe(false);
		expect(report.cleanCheckout).toBe(false);
		expect(report.unknownPaths).toEqual(["web/new.ts"]);
	});

	test("reports an exact baseline mismatch without treating inventory keys as paths", async () => {
		const repositoryRoot = await createRepository();
		const baseCommit = await revParse(repositoryRoot, "HEAD");
		await write(repositoryRoot, "api/modules/scans/example.ts", "planning\n");
		await commitAll(repositoryRoot, "planning");
		const planningBaselineCommit = await revParse(repositoryRoot, "HEAD");
		await write(repositoryRoot, "scripts/check.ts", "export {};\n");
		await commitAll(repositoryRoot, "candidate");
		const candidateCommit = await revParse(repositoryRoot, "HEAD");
		const report = await runScopeCli(
			repositoryRoot,
			contractFixture({
				changeSetBaseCommit: baseCommit,
				planningBaselineCommit,
			}),
			candidateCommit,
			3,
		);
		expect(report.ok).toBe(false);
		expect(report.unknownPaths).toEqual([]);
		expect(report.baselineMismatches).toEqual([
			"missing:modified:web/example.ts",
		]);
	});
});

function contractFixture(params: {
	changeSetBaseCommit: string;
	planningBaselineCommit: string;
}): ScannerHardeningCloseoutScopeContract {
	if (
		!/^([a-f0-9]{40})$/.test(params.changeSetBaseCommit) ||
		!/^([a-f0-9]{40})$/.test(params.planningBaselineCommit)
	) {
		throw new Error(`test_commit_fixture_invalid:${JSON.stringify(params)}`);
	}
	return scannerHardeningCloseoutScopeContractSchema.parse({
		schemaVersion: 1,
		...params,
		expectedBaselineChangeCount: 2,
		baselineInventory: [
			{
				status: "modified",
				path: "api/modules/scans/example.ts",
				classification: "scanner_hardening",
				reasonCode: "scanner_production",
			},
			{
				status: "modified",
				path: "web/example.ts",
				classification: "separate_ui",
				reasonCode: "phase_56_ui_contract",
			},
		],
		allowedResidualPatterns: ["scripts/**", "spec/generated/table.html"],
		excludedResidualPatterns: ["web/**"],
		generatedPaths: [
			{
				path: "spec/generated/table.html",
				command: ["bun", "run", "generate"],
			},
		],
		requiredResidualPaths: ["scripts/check.ts"],
	});
}

async function runScopeCli(
	repositoryRoot: string,
	contract: ScannerHardeningCloseoutScopeContract,
	candidate: string,
	expectedExitCode: number,
) {
	const outputRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "scanner-hardening-scope-output-"),
	);
	temporaryDirectories.push(outputRoot);
	const contractPath = path.join(outputRoot, "scope-contract.json");
	const outputPath = path.join(outputRoot, "scope-report.json");
	await fs.writeFile(contractPath, `${JSON.stringify(contract)}\n`, "utf8");
	const child = Bun.spawn(
		[
			process.execPath,
			path.resolve(import.meta.dir, "check-scanner-hardening-closeout-scope.ts"),
			"--repository",
			repositoryRoot,
			"--contract",
			contractPath,
			"--candidate",
			candidate,
			"--out",
			outputPath,
		],
		{
			cwd: path.resolve(import.meta.dir, ".."),
			stdout: "ignore",
			stderr: "pipe",
		},
	);
	const stderrPromise = new Response(child.stderr).text();
	const exitCode = await child.exited;
	const stderr = await stderrPromise;
	if (exitCode !== expectedExitCode) {
		const report = await fs.readFile(outputPath, "utf8").catch(() => "");
		throw new Error(
			`scope_cli_exit_${exitCode}:${stderr.trim()}:${report.trim()}`,
		);
	}
	return JSON.parse(await fs.readFile(outputPath, "utf8")) as Awaited<
		ReturnType<typeof checkScannerHardeningCloseoutScope>
	>;
}

async function createRepository(): Promise<string> {
	const repositoryRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "scanner-hardening-scope-"),
	);
	temporaryDirectories.push(repositoryRoot);
	await git(repositoryRoot, ["init", "--object-format=sha1"]);
	await fs.mkdir(path.join(repositoryRoot, ".git/empty-hooks"));
	await git(repositoryRoot, ["config", "core.hooksPath", ".git/empty-hooks"]);
	await git(repositoryRoot, ["config", "user.name", "Test"]);
	await git(repositoryRoot, ["config", "user.email", "test@example.com"]);
	await write(repositoryRoot, "api/modules/scans/example.ts", "base\n");
	await write(repositoryRoot, "web/example.ts", "base ui\n");
	await commitAll(repositoryRoot, "base");
	return repositoryRoot;
}

async function write(
	repositoryRoot: string,
	relativePath: string,
	contents: string,
): Promise<void> {
	const absolutePath = path.join(repositoryRoot, relativePath);
	await fs.mkdir(path.dirname(absolutePath), { recursive: true });
	await fs.writeFile(absolutePath, contents, "utf8");
}

async function commitAll(
	repositoryRoot: string,
	message: string,
): Promise<void> {
	await git(repositoryRoot, ["add", "."]);
	await git(repositoryRoot, ["commit", "-m", message]);
}

async function revParse(
	repositoryRoot: string,
	revision: string,
): Promise<string> {
	if (revision !== "HEAD") throw new Error("test_revision_unsupported");
	const symbolicHead = (
		await fs.readFile(path.join(repositoryRoot, ".git/HEAD"), "utf8")
	).trim();
	if (!symbolicHead.startsWith("ref: ")) {
		if (!/^[a-f0-9]{40}$/.test(symbolicHead))
			throw new Error("test_detached_head_invalid");
		return symbolicHead;
	}
	const commit = (
		await fs.readFile(
			path.join(repositoryRoot, ".git", symbolicHead.slice("ref: ".length)),
			"utf8",
		)
	).trim();
	if (!/^[a-f0-9]{40}$/.test(commit))
		throw new Error("test_symbolic_head_invalid");
	return commit;
}

async function git(repositoryRoot: string, args: string[]): Promise<string> {
	return execFileSync("git", ["-C", repositoryRoot, ...args], {
		encoding: "utf8",
	}).trim();
}
