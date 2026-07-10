import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanReviews,
	scanRuns,
	toolRuns,
	users,
} from "../../db/schema";
import { buildStaticIntelligenceGeneration } from "./build-service";
import { ArtifactStorage } from "../scans/artifact-storage";

const NOW = new Date("2026-07-06T12:00:00.000Z");
const RAW_SNIPPET_MARKER = "RAW_SNIPPET_SHOULD_NOT_LEAK";
const RAW_ARTIFACT_MARKER = "RAW_ARTIFACT_BODY_SHOULD_NOT_LEAK";

describe("Static Intelligence guardrail material CLI", () => {
	let tempDir: string;
	let dbUrl: string;
	let connection: DbConnection;
	let scanRunId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "guardrail-material-cli-"),
		);
		dbUrl = `file:${path.join(tempDir, "test.sqlite")}`;
		connection = createDbConnection(dbUrl);
		applyMigrations(connection);
		scanRunId = await seedScan(connection, tempDir);
		await buildStaticIntelligenceGeneration({ db: connection.db, scanRunId, artifactStorage: new ArtifactStorage(path.join(tempDir, "artifacts")) });
		connection.sqlite.close();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("returns guardrail material JSON with exit code 0", () => {
		const result = runCli(["--scan-run-id", scanRunId]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			status: "completed",
			version: "v1",
		});
		expect(payload.sourceManifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(payload.materials.length).toBeGreaterThan(0);
		expect(
			payload.materials.every(
				(material: { candidateOnly: boolean }) =>
					material.candidateOnly === true,
			),
		).toBe(true);
	});

	it("filters by type", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--type",
			"verification_recipe_material",
		]);

		expect(result.status).toBe(0);
		const payload = JSON.parse(result.stdout);
		expect(payload.filters.type).toBe("verification_recipe_material");
		expect(payload.materials.length).toBeGreaterThan(0);
		expect(
			payload.materials.every(
				(material: { type: string }) =>
					material.type === "verification_recipe_material",
			),
		).toBe(true);
	});

	it("include markdown emits markdown in JSON only", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--include-markdown",
			"true",
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout.trim().startsWith("{")).toBe(true);
		expect(result.stdout.trim().endsWith("}")).toBe(true);
		const payload = JSON.parse(result.stdout);
		expect(payload.markdown).toContain(
			"# Static Intelligence Guardrail Material",
		);
	});

	it("returns exit code 2 when scan run is missing", () => {
		const result = runCli([
			"--scan-run-id",
			"00000000-0000-4000-8000-000000000001",
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({ ok: false, status: "failed" });
		expect(payload.message).toContain("generation missing");
	});

	it("returns exit code 2 for invalid type", () => {
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--type",
			"not_a_type",
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({ ok: false, status: "failed" });
		expect(payload.message).toContain("Invalid option");
	});

	it("does not leak repo path or raw markers", () => {
		const result = runCli(["--scan-run-id", scanRunId]);

		expect(result.status).toBe(0);
		expect(result.stdout).not.toContain(tempDir);
		expect(result.stdout).not.toContain(RAW_SNIPPET_MARKER);
		expect(result.stdout).not.toContain(RAW_ARTIFACT_MARKER);
	});

	it("material ids are stable across repeated CLI runs", () => {
		const first = JSON.parse(runCli(["--scan-run-id", scanRunId]).stdout);
		const second = JSON.parse(runCli(["--scan-run-id", scanRunId]).stdout);
		const firstIds = first.materials
			.map((material: { id: string }) => material.id)
			.sort();
		const secondIds = second.materials
			.map((material: { id: string }) => material.id)
			.sort();

		expect(first.generatedAt).not.toBe(second.generatedAt);
		expect(firstIds).toEqual(secondIds);
	});

	function runCli(args: string[]) {
		return spawnSync(
			process.execPath,
			["api/cli/intelligence-guardrail-material.ts", ...args],
			{
				cwd: process.cwd(),
				env: { ...process.env, DATABASE_URL: dbUrl, SCAN_ARTIFACT_ROOT: path.join(tempDir, "artifacts") },
				encoding: "utf8",
			},
		);
	}
});

async function seedScan(connection: DbConnection, repoPath: string) {
	const [user] = await connection.db
		.insert(users)
		.values({
			email: "guardrail-material-cli@example.com",
			passwordHash: "password",
			displayName: "Guardrail CLI User",
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
			name: "Guardrail Target",
			repoPath,
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
			completedAt: new Date(NOW.getTime() + 5000),
			createdByUserId: user.id,
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	const [toolRun] = await connection.db
		.insert(toolRuns)
		.values({
			scanRunId: scanRun.id,
			toolName: "semgrep",
			toolVersion: "1.100.0",
			command: "semgrep scan",
			status: "completed",
			exitCode: 0,
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 4000),
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	const [artifact] = await connection.db
		.insert(scanArtifacts)
		.values({
			scanRunId: scanRun.id,
			toolRunId: toolRun.id,
			kind: "raw_result",
			format: "json",
			path: "artifacts/semgrep.json",
			sha256: "fake-sha",
			sizeBytes: 200,
			metadata: { rawContent: RAW_ARTIFACT_MARKER },
			createdAt: NOW,
		})
		.returning();
	const [finding] = await connection.db
		.insert(findings)
		.values({
			scanRunId: scanRun.id,
			projectId: project.id,
			sourceTool: "semgrep",
			ruleId: "typescript.express.xss",
			title: "Reflected XSS",
			description: "User-controlled value reaches a dangerous sink.",
			severity: "high",
			confidence: "static",
			status: "open",
			primaryLocation: { path: "src/app.ts", startLine: 12 },
			fingerprint: "fp-xss",
			metadata: {},
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	await connection.db.insert(findingEvidences).values({
		findingId: finding.id,
		kind: "source-location",
		title: "Source location",
		artifactId: artifact.id,
		location: { path: "src/app.ts", startLine: 12 },
		snippet: RAW_SNIPPET_MARKER,
		metadata: {},
		createdAt: NOW,
	});
	await connection.db.insert(scanReviews).values({
		scanRunId: scanRun.id,
		projectId: project.id,
		provider: "openai",
		model: "gpt-4o-mini",
		status: "completed",
		summary: "Review completed.",
		riskOverview: "High risk XSS finding.",
		priorityNotes: ["Fix the XSS first."],
		coverageNotes: [],
		falsePositiveHotspots: [],
		recommendedNextActions: ["Patch and test."],
		findingTriageHints: [],
		confidenceNotes: [],
		inputBundle: {},
		output: {
			summary: "Review completed.",
			riskOverview: "High risk XSS finding.",
			priorityNotes: ["Fix the XSS first."],
			coverageNotes: [],
			falsePositiveHotspots: [],
			recommendedNextActions: ["Patch and test."],
			findingTriageHints: [],
			confidenceNotes: [],
			improvementRequest: {
				title: "Fix reflected XSS",
				objective: "Escape user-controlled output before rendering.",
				scope: ["Stored scan evidence only."],
				priorityPlan: [],
				implementationTasks: [],
				acceptanceCriteria: ["Injected HTML is escaped."],
				verificationCommands: ["bun test"],
				constraints: ["Do not add a new scanner."],
				nonGoals: ["Do not redesign the app."],
				handoffPrompt: "Fix the reflected XSS based on stored evidence.",
			},
		},
		startedAt: NOW,
		completedAt: new Date(NOW.getTime() + 1000),
		createdAt: NOW,
		updatedAt: NOW,
	});
	return scanRun.id;
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
