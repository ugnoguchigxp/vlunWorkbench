import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { createWritableTestDbConnection } from "../../db/testing/connection";
import { projects, scanRuns, users } from "../../db/schema";
import { buildStaticIntelligenceGeneration } from "./build-service";
import { staticIntelligenceMcpToolRegistry } from "./mcp-tools";

const NOW = new Date("2026-07-15T01:00:00.000Z");
const RAW_SOURCE_MARKER = "CATALOG_CLI_RAW_SOURCE_MUST_NOT_LEAK";

describe("Project exploration catalog CLI and MCP smoke", () => {
	let tempDir: string;
	let projectDir: string;
	let artifactDir: string;
	let databaseUrl: string;
	let scanRunId: string;
	let generationId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "exploration-catalog-cli-"));
		projectDir = path.join(tempDir, "project");
		artifactDir = path.join(tempDir, "artifacts");
		databaseUrl = `file:${path.join(tempDir, "catalog.sqlite")}`;
		await writeProjectFixture(projectDir);
		tempDir = await fs.realpath(tempDir);
		projectDir = await fs.realpath(projectDir);
		process.env.SCAN_ARTIFACT_ROOT = artifactDir;

		const connection = createWritableTestDbConnection(databaseUrl);
		try {
			applyMigrations(connection);
			const [user] = await connection.db
				.insert(users)
				.values({
					email: "catalog-cli@example.com",
					passwordHash: "password",
					displayName: "Catalog CLI User",
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
					name: "Catalog CLI Target",
					repoPath: projectDir,
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
			const generation = await buildStaticIntelligenceGeneration({
				db: connection.db,
				scanRunId,
				generatedAt: NOW,
			});
			generationId = generation.generationId;
		} finally {
			connection.sqlite.close();
		}
	});

	afterEach(async () => {
		delete process.env.SCAN_ARTIFACT_ROOT;
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("returns integration seams as machine-readable CLI JSON", () => {
		const result = runCatalogCli([
			"--scan-run-id",
			scanRunId,
			"--generation-id",
			generationId,
			"--path",
			"api/routes/fizzbuzz.ts",
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({ ok: true, version: "v1" });
		expect(paths(payload.likelyFiles)).toEqual(
			expect.arrayContaining([
				"api/routes/fizzbuzz.ts",
				"shared/http/http-client.ts",
				"shared/schemas/fizzbuzz.ts",
			]),
		);
		expect(paths(payload.relatedTests)).toContain(
			"tests/routes/fizzbuzz.test.ts",
		);
		expect(result.stdout).not.toContain(projectDir);
		expect(result.stdout).not.toContain(RAW_SOURCE_MARKER);
	});

	it("rejects an empty focus before opening the catalog", () => {
		const result = runCatalogCli([
			"--scan-run-id",
			scanRunId,
			"--generation-id",
			generationId,
		]);

		expect(result.status).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			status: "failed",
			reasonCode: "focus_required",
		});
	});

	it("lists and calls the catalog through the MCP tool registry", async () => {
		const catalogTool = staticIntelligenceMcpToolRegistry.find(
			(tool) => tool.name === "vuln_get_project_exploration_catalog",
		);
		expect(catalogTool).toMatchObject({
			name: "vuln_get_project_exploration_catalog",
			readOnlyHint: true,
		});
		if (!catalogTool) throw new Error("Catalog MCP tool is missing.");

		const connection = createDbConnection(databaseUrl);
		try {
			const payload = await catalogTool.handler({
				db: connection.db,
				input: {
					projectPath: projectDir,
					focus: { paths: ["api/routes/fizzbuzz.ts"] },
				},
				allowedProjectRoots: [tempDir],
				projectCreationPolicy: "registered_only",
			});
			expect(payload).toMatchObject({
				ok: true,
				projectPath: projectDir,
			});
			expect(
				paths(
					(payload as { likelyFiles: Array<{ path: string }> }).likelyFiles,
				),
			).toContain(
				"shared/http/http-client.ts",
			);

			const failedPayload = await catalogTool.handler({
				db: connection.db,
				input: {
					projectPath: path.join(tempDir, "missing-project"),
					focus: { terms: ["missing"] },
				},
				allowedProjectRoots: [tempDir],
				projectCreationPolicy: "registered_only",
			});
			expect(failedPayload).toMatchObject({
				ok: false,
				status: "failed",
			});
		} finally {
			connection.sqlite.close();
		}
	});

	function runCatalogCli(args: string[]) {
		return spawnSync(
			process.execPath,
			["api/cli/intelligence-exploration-catalog.ts", ...args],
			{
				cwd: process.cwd(),
				encoding: "utf8",
				env: {
					...process.env,
					DATABASE_URL: databaseUrl,
					SCAN_ARTIFACT_ROOT: artifactDir,
				},
			},
		);
	}
});

async function writeProjectFixture(projectDir: string) {
	await fs.mkdir(path.join(projectDir, ".git"), { recursive: true });
	await fs.mkdir(path.join(projectDir, "api", "routes"), { recursive: true });
	await fs.mkdir(path.join(projectDir, "shared", "http"), { recursive: true });
	await fs.mkdir(path.join(projectDir, "shared", "schemas"), { recursive: true });
	await fs.mkdir(path.join(projectDir, "tests", "routes"), { recursive: true });
	await fs.writeFile(
		path.join(projectDir, "api", "routes", "fizzbuzz.ts"),
		[
			'import { httpClient } from "../../shared/http/http-client";',
			'import { fizzBuzzInputSchema } from "../../shared/schemas/fizzbuzz";',
			`export const fizzBuzzRoute = ${JSON.stringify(RAW_SOURCE_MARKER)};`,
			"void httpClient; void fizzBuzzInputSchema;",
		].join("\n"),
	);
	await fs.writeFile(
		path.join(projectDir, "shared", "http", "http-client.ts"),
		"export const httpClient = { get: async () => ({ ok: true }) };\n",
	);
	await fs.writeFile(
		path.join(projectDir, "shared", "schemas", "fizzbuzz.ts"),
		"export const fizzBuzzInputSchema = { parse: (value: unknown) => value };\n",
	);
	await fs.writeFile(
		path.join(projectDir, "tests", "routes", "fizzbuzz.test.ts"),
		'import { fizzBuzzRoute } from "../../api/routes/fizzbuzz"; void fizzBuzzRoute;\n',
	);
}

function paths(items: Array<{ path: string }>): string[] {
	return items.map((item) => item.path);
}

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((left, right) => left.localeCompare(right))) {
		connection.sqlite.exec(readFileSync(path.join(migrationsDir, filename), "utf8"));
	}
}
