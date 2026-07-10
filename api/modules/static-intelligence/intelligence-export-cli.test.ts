import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanRuns, users } from "../../db/schema";
import { buildStaticIntelligenceGeneration } from "./build-service";
import { ArtifactStorage } from "../scans/artifact-storage";

const NOW = new Date("2026-07-05T12:00:00.000Z");

describe("Static Intelligence export CLI", () => {
	let tempDir: string;
	let dbUrl: string;
	let connection: DbConnection;
	let projectId: string;
	let scanRunId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "static-intelligence-cli-"),
		);
		dbUrl = `file:${path.join(tempDir, "test.sqlite")}`;
		connection = createDbConnection(dbUrl);
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "static-intel-cli@example.com",
				passwordHash: "password",
				displayName: "Static Intel CLI User",
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
				name: "CLI Target Project",
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
		await buildStaticIntelligenceGeneration({ db: connection.db, scanRunId, artifactStorage: new ArtifactStorage(path.join(tempDir, "artifacts")) });
		connection.sqlite.close();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("writes a single JSON result to stdout and optional export file", async () => {
		const outputPath = path.join(tempDir, "static-intelligence.json");
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--output",
			outputPath,
			"--pretty",
			"true",
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: true,
			status: "completed",
			scanRunId,
			output: { path: outputPath },
		});
		expect(stdoutPayload.export.version).toBe("v1");

		const filePayload = JSON.parse(await fs.readFile(outputPath, "utf8"));
		expect(filePayload.version).toBe("v1");
		expect(filePayload.scan.id).toBe(scanRunId);
	});

	it("includes optional code structure enrichment from snapshot file", async () => {
		const snapshotPath = path.join(tempDir, "code-structure.json");
		await fs.writeFile(
			snapshotPath,
			JSON.stringify(
				await codeStructureSnapshotFixture({ projectId, projectPath: tempDir }),
			),
			"utf8",
		);

		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--code-structure-snapshot",
			snapshotPath,
		]);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload.export.codeStructure).toMatchObject({
			status: "available",
			fileTagsByPath: { "src/app.ts": ["route", "handler", "source"] },
		});
		expect(JSON.stringify(stdoutPayload.export.codeStructure)).not.toContain(
			"SECRET_CODE_STRUCTURE_SOURCE",
		);
	});

	it("returns exit code 2 for invalid code structure snapshot", async () => {
		const snapshotPath = path.join(tempDir, "invalid-code-structure.json");
		await fs.writeFile(
			snapshotPath,
			JSON.stringify({
				...(await codeStructureSnapshotFixture({
					projectId,
					projectPath: tempDir,
				})),
				project: {
					...(await codeStructureSnapshotFixture({
						projectId,
						projectPath: tempDir,
					})).project,
					rootPathIncluded: false,
					rootPath: tempDir,
				},
			}),
			"utf8",
		);

		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--code-structure-snapshot",
			snapshotPath,
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload).toMatchObject({
			ok: false,
			status: "failed",
		});
		expect(stdoutPayload.message).toContain("Invalid code structure snapshot");
		expect(stdoutPayload.message).toContain("rootPath must be omitted");
		expect(stdoutPayload.message).not.toContain(tempDir);
	});

	it("does not leak snapshot file paths when snapshot read fails", () => {
		const missingSnapshotPath = path.join(tempDir, "missing-snapshot.json");
		const result = runCli([
			"--scan-run-id",
			scanRunId,
			"--code-structure-snapshot",
			missingSnapshotPath,
		]);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const stdoutPayload = JSON.parse(result.stdout);
		expect(stdoutPayload.message).toContain("failed to read snapshot file");
		expect(stdoutPayload.message).not.toContain(missingSnapshotPath);
		expect(stdoutPayload.message).not.toContain(tempDir);
	});

	it("returns exit code 2 and JSON failure when scan run is missing", () => {
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
			message: "Static Intelligence generation missing.",
		});
	});

	function runCli(args: string[]) {
		return spawnSync(process.execPath, ["api/cli/intelligence-export.ts", ...args], {
			cwd: process.cwd(),
			env: { ...process.env, DATABASE_URL: dbUrl, SCAN_ARTIFACT_ROOT: path.join(tempDir, "artifacts") },
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

async function codeStructureSnapshotFixture(options: {
	projectId?: string;
	projectPath: string;
}) {
	return {
		version: "v1",
		generatedAt: "2026-07-06T12:00:00.000Z",
		project: {
			...(options.projectId ? { id: options.projectId } : {}),
			rootRef: createHash("sha256")
				.update(await fs.realpath(options.projectPath))
				.digest("hex"),
			rootPathIncluded: false,
		},
		status: "completed",
		degradedReasons: [],
		files: [
			{
				path: "src/app.ts",
				language: "typescript",
				moduleKind: "esm",
				tags: ["route", "handler", "source"],
				exportedSymbols: ["App"],
				imports: ["hono"],
				packageImports: ["hono"],
				contentHash:
					"abcdef0000000000000000000000000000000000000000000000000000000000",
				parseStatus: "parsed",
				degradedReasons: ["SECRET_CODE_STRUCTURE_SOURCE"],
			},
		],
		edges: [],
		packages: [{ name: "hono", importedBy: ["src/app.ts"] }],
		summary: {
			fileCount: 1,
			parsedFileCount: 1,
			skippedFileCount: 0,
			importEdgeCount: 0,
			packageDependencyCount: 1,
			exportedSymbolCount: 1,
			routeFileCount: 1,
			handlerFileCount: 1,
			schemaFileCount: 0,
			workerFileCount: 0,
			testFileCount: 0,
			configFileCount: 0,
		},
	};
}
