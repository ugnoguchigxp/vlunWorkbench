import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanRuns, users } from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";
import { migrateTestDatabase } from "../../db/testing/migrate";

const NOW = new Date("2026-07-10T13:00:00.000Z");

describe("Static Intelligence build CLI", () => {
	let connection: DbConnection;
	let tempDir: string;
	let databaseUrl: string;
	let artifactDir: string;
	let scanRunId: string;
	let projectId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "static-intel-build-cli-"));
		artifactDir = path.join(tempDir, "artifacts");
		const projectDir = path.join(tempDir, "project");
		await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(projectDir, "src", "app.ts"),
			"export const app = true;\n",
			"utf8",
		);
		databaseUrl = `file:${path.join(tempDir, "test.sqlite")}`;
		await migrateTestDatabase(databaseUrl);
		connection = createDbConnection(databaseUrl);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "build-cli@example.com",
				passwordHash: "password",
				displayName: "Build CLI User",
				role: "member",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: user!.id,
				name: "Build CLI Target",
				repoPath: projectDir,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		projectId = project!.id;
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId: project!.id,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: NOW,
				createdByUserId: user!.id,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		scanRunId = scanRun!.id;
		await closeTestDbConnection(connection);
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("writes one JSON build result and persists a reusable generation", () => {
		const result = runCli(["--scan-run-id", scanRunId, "--pretty", "true"]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		const generationId = payload.generation.generationId as string;
		expect(payload).toMatchObject({
			ok: true,
			status: "partial",
			scanRunId,
			generation: { generationId: expect.any(String) },
		});
		expect(payload.stages.map((stage: { name: string }) => stage.name)).toEqual([
			"validate_source",
			"build_inventory",
			"analyze_files",
			"resolve_references",
			"infer_modules",
			"build_v2_snapshot",
			"project_export_projection",
			"normalize_paths",
			"build_export",
			"persist_generation",
			"build_manifest",
			"optional_semantic_index",
		]);

		const persistedExport = runScript("api/cli/intelligence-export.ts", [
			"--scan-run-id",
			scanRunId,
			"--generation-id",
			generationId,
		]);
		expect(persistedExport.status).toBe(0);
		expect(JSON.parse(persistedExport.stdout)).toMatchObject({
			ok: true,
			generationId,
			export: { scan: { id: scanRunId } },
		});
	});

	it("returns exit code 2 for a missing scan", () => {
		const result = runCli([
			"--scan-run-id",
			"00000000-0000-4000-8000-000000000001",
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			status: "failed",
			message: "Scan run not found: 00000000-0000-4000-8000-000000000001",
		});
	});

	it("reports an unavailable semantic provider without failing the persisted build", () => {
		const result = runCli(
			[
				"--scan-run-id",
				scanRunId,
				"--include-semantic",
				"true",
			],
			{
				AZURE_OPENAI_ENDPOINT: "",
				AZURE_OPENAI_API_KEY: "",
			},
		);

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout).stages.at(-1)).toMatchObject({
			name: "optional_semantic_index",
			status: "skipped",
			reasonCodes: ["semantic_index_provider_unavailable"],
		});
	});

	function runCli(args: string[], envOverrides: Record<string, string> = {}) {
		return runScript("api/cli/intelligence-build.ts", args, envOverrides);
	}

	function runScript(
		script: string,
		args: string[],
		envOverrides: Record<string, string> = {},
	) {
		return spawnSync(process.execPath, [script, ...args], {
			cwd: process.cwd(),
			env: {
				...process.env,
				...envOverrides,
				DATABASE_URL: databaseUrl,
				SCAN_ARTIFACT_ROOT: artifactDir,
			},
			encoding: "utf8",
		});
	}
});
