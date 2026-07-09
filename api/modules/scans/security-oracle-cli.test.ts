import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of sqlFiles) {
		connection.sqlite.exec(
			readFileSync(path.join(migrationsDir, filename), "utf8"),
		);
	}
}

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
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify({ results: [] }));
}
process.exit(0);
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
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify([]));
}
process.exit(0);
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
const outIdx = args.indexOf("--output");
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

		connection = createDbConnection(dbUrl);
		applyMigrations(connection);
	});

	afterEach(async () => {
		connection.sqlite.close(false);
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	function runCli(args: string[], envOverrides: Record<string, string> = {}) {
		return Bun.spawnSync([process.execPath, "run", ...args], {
			env: {
				...process.env,
				DATABASE_URL: dbUrl,
				SCAN_ARTIFACT_ROOT: artifactRoot,
				PATH: `${mockBinDir}:${process.env.PATH ?? ""}`,
				OPENAI_API_KEY: "",
				AZURE_OPENAI_API_KEY: "",
				AZURE_OPENAI_ENDPOINT: "",
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
			"--profile",
			"agent-output",
			"--review",
			"false",
			"--format",
			"json",
		]);
		const firstPayload = JSON.parse(first.stdout.toString());

		expect(first.exitCode).toBe(0);
		expect(firstPayload).toMatchObject({
			ok: true,
			status: "completed",
			project: { repoPath, created: true },
			scan: {
				profile: "agent-output",
				findingCount: 0,
				highOrCriticalCount: 0,
			},
			review: { status: "not_requested" },
			nextAction: "none",
		});
		expect(firstPayload.scan.scanRunId).toBeTruthy();
		expect(first.stdout.toString().trim().split("\n")).toHaveLength(1);

		const second = runCli([
			"api/cli/oracle-security.ts",
			"--project-path",
			path.join(repoPath, "."),
			"--profile",
			"agent-output",
			"--review",
			"false",
			"--format",
			"json",
		]);
		const secondPayload = JSON.parse(second.stdout.toString());
		const projects = await connection.db.query.projects.findMany();

		expect(second.exitCode).toBe(0);
		expect(secondPayload.project.created).toBe(false);
		expect(projects).toHaveLength(1);
	});

	it("keeps stdout JSON-only through the package script entrypoint", async () => {
		const proc = runCli([
			"oracle:security",
			"--",
			"--project-path",
			repoPath,
			"--profile",
			"agent-output",
			"--review",
			"false",
			"--format",
			"json",
		]);
		const stdout = proc.stdout.toString().trim();
		const payload = JSON.parse(stdout);

		expect(proc.exitCode).toBe(0);
		expect(stdout.split("\n")).toHaveLength(1);
		expect(payload.status).toBe("completed");
	});

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
	});

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
	});

	it("keeps scan result when requested review fails", async () => {
		const proc = runCli([
			"api/cli/oracle-security.ts",
			"--project-path",
			repoPath,
			"--profile",
			"agent-output",
			"--review",
			"true",
			"--format",
			"json",
		]);
		const payload = JSON.parse(proc.stdout.toString());

		expect(proc.exitCode).toBe(2);
		expect(payload).toMatchObject({
			ok: false,
			status: "config_error",
			project: { repoPath },
			scan: {
				profile: "agent-output",
				findingCount: 0,
				highOrCriticalCount: 0,
			},
			review: { status: "failed" },
			nextAction: "configure_provider",
			error: { code: "SCAN_REVIEW_FAILED" },
		});
		expect(payload.scan.scanRunId).toBeTruthy();
		expect(payload.review.reviewId).toBeTruthy();
	});

	it("returns JSON config failure when oracle startup config is invalid", async () => {
		const proc = runCli(
			[
				"api/cli/oracle-security.ts",
				"--project-path",
				repoPath,
				"--profile",
				"agent-output",
				"--review",
				"false",
				"--format",
				"json",
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
	});

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
	});
});
