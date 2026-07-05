import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanRuns, users } from "../../db/schema";

const NOW = new Date("2026-07-05T12:00:00.000Z");

describe("Static Intelligence semantic CLIs", () => {
	let tempDir: string;
	let dbUrl: string;
	let connection: DbConnection;
	let scanRunId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "static-intelligence-semantic-cli-"),
		);
		dbUrl = `file:${path.join(tempDir, "test.sqlite")}`;
		connection = createDbConnection(dbUrl);
		applyMigrations(connection);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "static-semantic-cli@example.com",
				passwordHash: "password",
				displayName: "Static Semantic CLI User",
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
				name: "Semantic CLI Target",
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

	it("query returns a degraded empty result without provider config", () => {
		const result = runCli("api/cli/intelligence-query.ts", [
			"--scan-run-id",
			scanRunId,
			"--query",
			"auth risk",
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			status: "completed",
			scanRunId,
			results: [],
			degradedReasons: ["static intelligence embedding index is empty"],
		});
	});

	it("index reports missing scan before requiring provider config", () => {
		const missingScanRunId = "00000000-0000-4000-8000-000000000030";
		const result = runCli("api/cli/intelligence-index.ts", [
			"--scan-run-id",
			missingScanRunId,
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: false,
			status: "failed",
			message: `Scan run not found: ${missingScanRunId}`,
		});
	});

	function runCli(script: string, args: string[]) {
		return spawnSync(process.execPath, [script, ...args], {
			cwd: process.cwd(),
			env: {
				...process.env,
				DATABASE_URL: dbUrl,
				AZURE_OPENAI_ENDPOINT: "",
				AZURE_OPENAI_API_KEY: "",
			},
			encoding: "utf8",
		});
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
