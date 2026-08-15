import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { closeTestDbConnection } from "../../db/testing/connection";
import { migrateTestDatabase } from "../../db/testing/migrate";

async function writeMockTool(
	binDir: string,
	name: string,
	body: string,
): Promise<void> {
	await fs.writeFile(path.join(binDir, name), `#!${process.execPath}\n${body}`, {
		mode: 0o755,
	});
}

async function writeMockScanners(binDir: string): Promise<void> {
	await writeMockTool(
		binDir,
	"semgrep",
		`
import fs from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) {
	console.log("1.2.3");
	process.exit(0);
}
const outIdx = args.indexOf("--output");
if (outIdx >= 0) {
	const outPath = args[outIdx + 1];
	const results = process.env.MOCK_SEMGREP_FINDING === "missing-user"
		? [{
			check_id: "dockerfile.security.missing-user.missing-user",
			path: process.env.MOCK_SEMGREP_PATH ?? path.join(process.env.MOCK_REPO_PATH ?? process.cwd(), "Dockerfile"),
			start: { line: 18, col: 1 },
			end: { line: 18, col: 56 },
			extra: {
				message: "By not specifying a USER, a program in the container may run as root.",
				severity: "ERROR",
				metadata: { category: "security" },
				lines: "CMD [\\"bun\\", \\"run\\", \\"start\\"]"
			}
		}]
		: [];
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify({ results }));
}
process.exit(Number.parseInt(process.env.MOCK_SEMGREP_EXIT_CODE ?? "0", 10));
`,
	);
	await writeMockTool(
		binDir,
		"gitleaks",
		`
import fs from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("version")) {
	console.log("8.18.0");
	process.exit(0);
}
const outIdx = args.indexOf("--report-path");
if (outIdx >= 0) {
	const outPath = args[outIdx + 1];
	const findings = process.env.MOCK_GITLEAKS_FINDING === "generic-api-key"
		? [{
			RuleID: "generic-api-key",
			Description: "Generic API Key",
			File: process.env.MOCK_GITLEAKS_PATH ?? path.join(process.env.MOCK_REPO_PATH ?? process.cwd(), "Dockerfile"),
			StartLine: 18,
			EndLine: 18,
			Secret: "super-secret-value"
		}]
		: [];
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify(findings));
}
process.exit(Number.parseInt(process.env.MOCK_GITLEAKS_EXIT_CODE ?? "0", 10));
`,
	);
	await writeMockTool(
		binDir,
	"osv-scanner",
		`
import fs from "node:fs/promises";
import path from "node:path";
const args = process.argv.slice(2);
if (args.includes("--version")) {
	console.log("1.5.0");
	process.exit(0);
}
const outIdx = args.indexOf("--output-file");
if (outIdx >= 0) {
	const outPath = args[outIdx + 1];
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify({ results: [] }));
}
process.exit(0);
`,
	);
}

describe("Security oracle CLI contract", () => {
	let tempDir: string;
	let dbFile: string;
	let dbUrl: string;
	let artifactRoot: string;
	let repoPath: string;
	let mockBinDir: string;
	let reviewFixturePath: string;
	let connection: DbConnection;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "security-oracle-cli-"),
		);
		dbFile = path.join(tempDir, "test.sqlite");
		dbUrl = `file:${dbFile}`;
		artifactRoot = path.join(tempDir, "artifacts", "scans");
		repoPath = path.join(tempDir, "repo");
		mockBinDir = path.join(tempDir, "bin");
		await fs.mkdir(repoPath, { recursive: true });
		await fs.mkdir(mockBinDir, { recursive: true });
		await fs.writeFile(path.join(repoPath, "package.json"), "{}\n");
		repoPath = await fs.realpath(repoPath);
		await writeMockScanners(mockBinDir);
		reviewFixturePath = path.join(tempDir, "scan-review.json");
		await fs.writeFile(
			reviewFixturePath,
			JSON.stringify({
				summary: "検出事項はありません。",
				riskOverview: "保存済み証跡の範囲では高リスク事項はありません。",
				priorityNotes: ["追加の変更は不要です。"],
				coverageNotes: ["agent-output プロファイルの保存済み結果です。"],
				falsePositiveHotspots: [],
				recommendedNextActions: ["通常の回帰テストを継続してください。"],
				findingTriageHints: [],
				confidenceNotes: ["判断は保存済み scan context に限定されます。"],
				findingAssessments: [],
				systemicRiskThemes: [],
				limitations: [],
				improvementRequest: {
					title: "セキュリティ回帰維持依頼",
					objective: "現在のゼロ件状態を回帰テストで維持する。",
					scope: ["vulnWorkbench が保存した scan context の範囲。"],
					priorityPlan: [],
					implementationTasks: [],
					acceptanceCriteria: ["既存テストが成功すること。"],
					verificationCommands: ["bun test"],
					constraints: ["vulnWorkbench 外の状態を変更しない。"],
					nonGoals: ["外部 orchestrator の変更。"],
					handoffPrompt: "保存済み scan context に基づき、現在のゼロ件状態を回帰テストで維持してください。",
				},
			}),
		);

		await migrateTestDatabase(dbUrl);
		connection = createDbConnection(dbUrl);
	});

	afterEach(async () => {
		await closeTestDbConnection(connection);
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	function runCli(args: string[], envOverrides: Record<string, string> = {}) {
		return Bun.spawnSync([process.execPath, "run", ...args], {
				env: {
					...process.env,
					NODE_ENV: "test",
					DATABASE_URL: dbUrl,
				SCAN_ARTIFACT_ROOT: artifactRoot,
				PATH: `${mockBinDir}:${process.env.PATH ?? ""}`,
				OPENAI_API_KEY: "",
				AZURE_OPENAI_API_KEY: "",
				AZURE_OPENAI_ENDPOINT: "",
				VULN_WORKBENCH_SCAN_REVIEW_FIXTURE: reviewFixturePath,
				...envOverrides,
			},
			stderr: "pipe",
			stdout: "pipe",
		});
	}

	it("runs oracle:security from project path and does not duplicate projects", async () => {
		const first = runCli([
			"api/cli/oracle-security.ts",
			"--project-path",
			repoPath,
		]);
		const firstPayload = JSON.parse(first.stdout.toString());

		expect({
			exitCode: first.exitCode,
			payload: firstPayload,
			stderr: first.stderr.toString(),
		}).toMatchObject({ exitCode: 0 });
		expect(firstPayload).toMatchObject({
			ok: true,
			status: "completed",
			project: { repoPath, created: true },
			scan: {
				profile: "agent-output",
				findingCount: 0,
				highOrCriticalCount: 0,
				coverage: { completed: 2, skipped: 0, failed: 0, gaps: [] },
			},
			review: {
				status: "completed",
				improvementRequest: expect.stringContaining("保存済み scan context"),
			},
			nextAction: "none",
		});
		expect(firstPayload.scan.scanRunId).toBeTruthy();
		expect(firstPayload.scan).not.toHaveProperty("reportPath");
		expect(first.stdout.toString().trim().split("\n")).toHaveLength(1);

		const second = runCli([
			"api/cli/oracle-security.ts",
			"--project-path",
			path.join(repoPath, "."),
		]);
		const secondPayload = JSON.parse(second.stdout.toString());
		const projects = await connection.db.query.projects.findMany();

		expect(second.exitCode).toBe(0);
		expect(secondPayload.project.created).toBe(false);
		expect(projects).toHaveLength(1);
	}, 30_000);

	it("keeps stdout JSON-only through the package script entrypoint", async () => {
		const proc = runCli([
			"oracle:security",
			"--",
			"--project-path",
			repoPath,
		]);
		const stdout = proc.stdout.toString().trim();
		const payload = JSON.parse(stdout);

		expect({
			exitCode: proc.exitCode,
			payload,
			stderr: proc.stderr.toString(),
		}).toMatchObject({ exitCode: 0 });
		expect(stdout.split("\n")).toHaveLength(1);
		expect(payload.status).toBe("completed");
	}, 30_000);

	it("returns actionable top findings in oracle JSON", async () => {
		await fs.writeFile(
			path.join(repoPath, "Dockerfile"),
			"FROM oven/bun:1.3.14\nCMD [\"bun\", \"run\", \"start\"]\n",
		);
		const proc = runCli(
			[
				"api/cli/oracle-security.ts",
				"--project-path",
				repoPath,
			],
			{
				MOCK_REPO_PATH: repoPath,
				MOCK_GITLEAKS_FINDING: "generic-api-key",
			},
		);
		const payload = JSON.parse(proc.stdout.toString());

		expect(proc.exitCode).toBe(3);
		expect(payload).toMatchObject({
			ok: false,
			status: "security_action_required",
			scan: {
				findingCount: 1,
				highOrCriticalCount: 1,
				findings: [
					{
						severity: "high",
						tool: "gitleaks",
						ruleId: "generic-api-key",
					location: {
							path: "Dockerfile",
							line: 18,
						},
						recommendation:
							"Dockerfile:18 で Generic API Key に対応する制御を追加してください。",
					},
				],
			},
			nextAction: "apply_security_fix",
		});
		expect(payload.scan.findings[0].title).toContain("API Key");
		expect(proc.stderr.toString()).toBe("");
	}, 30_000);

	it("does not expose finding paths outside the requested repository", async () => {
		const outsidePath = path.join(tempDir, "other-project", "Dockerfile");
		const proc = runCli(
			[
				"api/cli/oracle-security.ts",
				"--project-path",
				repoPath,
			],
			{
				MOCK_REPO_PATH: repoPath,
				MOCK_GITLEAKS_PATH: outsidePath,
				MOCK_GITLEAKS_FINDING: "generic-api-key",
			},
		);
		const stdout = proc.stdout.toString();
		const payload = JSON.parse(stdout);

		expect(proc.exitCode).toBe(3);
		expect(payload.scan.findings[0].location).toBeNull();
		expect(stdout).not.toContain(outsidePath);
		expect(payload.scan).not.toHaveProperty("reportPath");
	}, 30_000);

	it("treats scanner findings as actionable even when the tool exits nonzero", async () => {
		await fs.writeFile(
			path.join(repoPath, "Dockerfile"),
			"FROM oven/bun:1.3.14\nCMD [\"bun\", \"run\", \"start\"]\n",
		);
		const proc = runCli(
			[
				"api/cli/oracle-security.ts",
				"--project-path",
				repoPath,
			],
			{
				MOCK_REPO_PATH: repoPath,
				MOCK_GITLEAKS_EXIT_CODE: "1",
				MOCK_GITLEAKS_FINDING: "generic-api-key",
			},
		);
		const payload = JSON.parse(proc.stdout.toString());

		expect(proc.exitCode).toBe(3);
		expect(payload).toMatchObject({
			ok: false,
			status: "security_action_required",
			scan: {
				findingCount: 1,
				highOrCriticalCount: 1,
				findings: [
					{
						ruleId: "generic-api-key",
						recommendation:
							"Dockerfile:18 で Generic API Key に対応する制御を追加してください。",
					},
				],
			},
			nextAction: "apply_security_fix",
		});
	}, 30_000);

	it("lets scan:profile create a project from project path", async () => {
		const proc = runCli([
			"api/cli/scan-profile.ts",
			"--project-path",
			repoPath,
			"--create-project",
			"true",
			"--profile",
			"agent-output",
			"--json",
		]);
		const payload = JSON.parse(proc.stdout.toString());

		expect(proc.exitCode).toBe(0);
		expect(payload.ok).toBe(true);
		expect(payload.project).toMatchObject({
			repoPath,
			created: true,
		});
		expect(payload.scanRunId).toBeTruthy();
	}, 30_000);

	it("returns exit code 2 with stable JSON when project path is missing and create is disabled", async () => {
		const proc = runCli([
			"api/cli/scan-profile.ts",
			"--project-path",
			repoPath,
			"--create-project",
			"false",
			"--profile",
			"agent-output",
			"--json",
		]);
		const payload = JSON.parse(proc.stdout.toString());

		expect(proc.exitCode).toBe(2);
		expect(payload).toMatchObject({
			ok: false,
			status: "config_error",
			error: { code: "PROJECT_NOT_FOUND" },
		});
		expect(payload.scanRunId).toBeUndefined();
	}, 30_000);

	it("rejects orchestrator-supplied scan tuning arguments", async () => {
		const forbiddenArguments = [
			["--profile", "agent-output"],
			["--target", "full"],
			["--finding-limit", "1"],
			["--expected-target-digest", "sha256:untrusted"],
		];

		for (const tuningArguments of forbiddenArguments) {
			const proc = runCli([
				"api/cli/oracle-security.ts",
				"--project-path",
				repoPath,
				...tuningArguments,
			]);
			const payload = JSON.parse(proc.stdout.toString());

			expect(proc.exitCode).toBe(2);
			expect(payload).toMatchObject({
				ok: false,
				status: "config_error",
				project: null,
				scan: null,
				review: { status: "skipped" },
				nextAction: "inspect_diagnostic_failure",
				error: { code: "ARGUMENT_PARSE_FAILED" },
			});
			expect(proc.stderr.toString()).toBe("");
		}
	}, 30_000);

	it("returns JSON config failure when oracle startup config is invalid", async () => {
		const proc = runCli(
			[
				"api/cli/oracle-security.ts",
				"--project-path",
				repoPath,
			],
			{ DATABASE_URL: "postgres://localhost/vuln_workbench" },
		);
		const stdout = proc.stdout.toString().trim();
		const payload = JSON.parse(stdout);

		expect(proc.exitCode).toBe(2);
		expect(stdout.split("\n")).toHaveLength(1);
		expect(proc.stderr.toString()).toBe("");
		expect(payload).toMatchObject({
			ok: false,
			status: "config_error",
			error: { code: "APP_CONFIG_ERROR" },
		});
	}, 30_000);

	it("returns JSON config failure when scan:profile startup config is invalid", async () => {
		const proc = runCli(
			[
				"api/cli/scan-profile.ts",
				"--project-path",
				repoPath,
				"--create-project",
				"true",
				"--profile",
				"agent-output",
				"--json",
			],
			{ DATABASE_URL: "postgres://localhost/vuln_workbench" },
		);
		const stdout = proc.stdout.toString().trim();
		const payload = JSON.parse(stdout);

		expect(proc.exitCode).toBe(2);
		expect(stdout.split("\n")).toHaveLength(1);
		expect(proc.stderr.toString()).toBe("");
		expect(payload).toMatchObject({
			ok: false,
			status: "config_error",
			error: { code: "APP_CONFIG_ERROR" },
		});
	}, 30_000);
});
