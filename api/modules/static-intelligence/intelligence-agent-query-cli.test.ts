import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanRuns, users } from "../../db/schema";

const NOW = new Date("2026-07-05T12:00:00.000Z");

describe("Static Intelligence agent query CLI", () => {
	let tempDir: string;
	let dbUrl: string;
	let connection: DbConnection;
	let scanRunId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-query-cli-"));
		dbUrl = `file:${path.join(tempDir, "test.sqlite")}`;
		connection = createDbConnection(dbUrl);
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "agent-query-cli@example.com",
				passwordHash: "password",
				displayName: "Agent Query CLI User",
				role: "member",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: user.id,
				name: "CLI Agent Target",
				repoPath: tempDir,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId: project.id,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: NOW,
				createdByUserId: user.id,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		scanRunId = scanRun.id;
		connection.sqlite.close();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("returns project overview JSON with exit code 0", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--kind",
			"project_overview",
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: true,
			status: "completed",
			scanRunId,
			queryKind: "project_overview",
		});
	});

	it("returns exit code 2 when evidence_bundle is missing finding id", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--kind",
			"evidence_bundle",
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: false,
			status: "failed",
		});
		expect(stdoutPayload.message).toContain("evidence_bundle requires findingId");
	});

	it("returns exit code 2 when scan run is missing", () => {
		const result = runCli([
			"--scan-run-id",
			"00000000-0000-4000-8000-000000000001",
			"--kind",
			"project_overview",
		]);

		expect(result.status).toBe(2);
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload.message).toBe(
			"Scan run not found: 00000000-0000-4000-8000-000000000001",
		);
	});

	it("pretty true still writes one JSON object", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--kind",
			"project_overview",
			"--pretty",
			"true",
		]);

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).ok).toBe(true);
		expect(result.stdout.trim().startsWith("{")).toBe(true);
		expect(result.stdout.trim().endsWith("}")).toBe(true);
	});

	it("returns degraded JSON for semantic community requests with an empty index", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--kind",
			"risk_context",
			"--query",
			"auth validation risk",
			"--include-semantic",
			"true",
			"--include-communities",
			"true",
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: true,
			status: "completed",
			scanRunId,
			queryKind: "risk_context",
		});
		expect(stdoutPayload.degradedReasons).toContain(
			"static intelligence embedding index is empty",
		);
	});

	function runCli(args: string[]) {
		return spawnSync(
			process.execPath,
			["api/cli/intelligence-agent-query.ts", ...args],
			{
				cwd: process.cwd(),
				env: { ...process.env, DATABASE_URL: dbUrl },
				encoding: "utf8",
			},
		);
	}
});

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of sqlFiles) {
		const sqlPath = path.resolve(migrationsDir, filename);
		connection.sqlite.exec(readFileSync(sqlPath, "utf8"));
	}
}
