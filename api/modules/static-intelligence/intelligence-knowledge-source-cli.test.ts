import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanReviews, scanRuns, users } from "../../db/schema";

const NOW = new Date("2026-07-05T12:00:00.000Z");
const RAW_MARKER = "SECRET_REVIEW_BODY_SHOULD_NOT_LEAK";

describe("Static Intelligence knowledge source CLI", () => {
	let tempDir: string;
	let dbUrl: string;
	let connection: DbConnection;
	let projectId: string;
	let scanRunId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "knowledge-source-cli-"),
		);
		dbUrl = `file:${path.join(tempDir, "test.sqlite")}`;
		connection = createDbConnection(dbUrl);
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "knowledge-source-cli@example.com",
				passwordHash: "password",
				displayName: "Knowledge Source CLI User",
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
				name: "CLI Knowledge Source Target",
				repoPath: tempDir,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		projectId = project.id;
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
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
		await seedCompletedScanReview(scanRunId);
		connection.sqlite.close();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("returns manifest JSON with exit code 0", () => {
		const result = runCli(["--scan-run-id", scanRunId]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: true,
			status: "completed",
			version: "v1",
		});
		expect(stdoutPayload.manifest.source.scanRunId).toBe(scanRunId);
		expect(stdoutPayload.manifest.source.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(
			stdoutPayload.manifest.availableBundles.some(
				(bundle: { kind: string; command: string[] }) =>
					bundle.kind === "code_structure_snapshot" &&
					bundle.command.includes("<project-path>"),
			),
		).toBe(true);
	});

	it("pretty true still writes one JSON object", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--pretty",
			"true",
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout.trim().startsWith("{")).toBe(true);
		expect(result.stdout.trim().endsWith("}")).toBe(true);
		expect(JSON.parse(result.stdout).ok).toBe(true);
	});

	it("returns exit code 2 when scan run is missing", () => {
		const result = runCli([
			"--scan-run-id",
			"00000000-0000-4000-8000-000000000001",
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: false,
			status: "failed",
		});
		expect(stdoutPayload.message).toContain("Scan run not found");
	});

	it("returns exit code 2 for invalid pretty", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--pretty",
			"yes",
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: false,
			status: "failed",
		});
		expect(stdoutPayload.message).toContain("--pretty must be true or false");
	});

	it("returns exit code 1 for invalid database configuration", () => {
		const result = runCliWithEnv(["--scan-run-id", scanRunId], {
			DATABASE_URL: "postgres://localhost/vuln_workbench",
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: false,
			status: "failed",
		});
		expect(stdoutPayload.message).toContain("DATABASE_URL must point to SQLite");
	});

	it("does not leak repo path or raw markers", () => {
		const result = runCli(["--scan-run-id", scanRunId]);

		expect(result.status).toBe(0);
		expect(result.stdout).not.toContain(tempDir);
		expect(result.stdout).not.toContain(RAW_MARKER);
	});

	it("content hash is stable across repeated CLI runs", () => {
		const first = runCli(["--scan-run-id", scanRunId]);
		const second = runCli(["--scan-run-id", scanRunId]);

		expect(first.status).toBe(0);
		expect(second.status).toBe(0);
		const firstPayload = JSON.parse(first.stdout);
		const secondPayload = JSON.parse(second.stdout);
		expect(firstPayload.manifest.source.contentHash).toBe(
			secondPayload.manifest.source.contentHash,
		);
	});

	function runCli(args: string[]) {
		return runCliWithEnv(args, { DATABASE_URL: dbUrl });
	}

	function runCliWithEnv(args: string[], env: Record<string, string>) {
		return spawnSync(
			process.execPath,
			["api/cli/intelligence-knowledge-source.ts", ...args],
			{
				cwd: process.cwd(),
				env: { ...process.env, ...env },
				encoding: "utf8",
			},
		);
	}

	async function seedCompletedScanReview(scanRunIdToReview: string) {
		await connection.db.insert(scanReviews).values({
			scanRunId: scanRunIdToReview,
			projectId,
			provider: "openai",
			model: "gpt-4o-mini",
			status: "completed",
			summary: "Review completed.",
			riskOverview: "No findings in this scan.",
			priorityNotes: [],
			coverageNotes: [],
			falsePositiveHotspots: [],
			recommendedNextActions: [],
			findingTriageHints: [],
			confidenceNotes: [],
			inputBundle: {},
			output: buildScanReviewOutput(),
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 1000),
			createdAt: NOW,
			updatedAt: NOW,
		});
	}
});

function buildScanReviewOutput() {
	return {
		summary: "Review completed.",
		riskOverview: "No findings in this scan.",
		priorityNotes: [],
		coverageNotes: [],
		falsePositiveHotspots: [],
		recommendedNextActions: [],
		findingTriageHints: [],
		confidenceNotes: [],
		improvementRequest: {
			title: RAW_MARKER,
			objective: "Keep manifest discovery read-only.",
			scope: ["Stored scan evidence only."],
			priorityPlan: [],
			implementationTasks: [],
			acceptanceCriteria: ["Manifest does not leak raw review body."],
			verificationCommands: ["bun test"],
			constraints: ["Do not call external systems."],
			nonGoals: ["Do not register contextStill knowledge."],
			handoffPrompt: RAW_MARKER,
		},
	};
}

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
