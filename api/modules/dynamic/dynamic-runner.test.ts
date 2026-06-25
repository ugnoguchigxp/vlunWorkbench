import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { findings, projects, scanRuns, users } from "../../db/schema";
import { DynamicRepository } from "./dynamic-repository";
import { DynamicRunner } from "./dynamic-runner";

function streamText(text: string) {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});
}

describe("Dynamic Runner", () => {
	let connection: DbConnection;
	let runner: DynamicRunner;
	let repo: DynamicRepository;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let configId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");

		// Apply Drizzle migrations manually to in-memory SQLite
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		const sqlFiles = readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b));

		for (const filename of sqlFiles) {
			const sqlPath = path.resolve(migrationsDir, filename);
			const sqlText = readFileSync(sqlPath, "utf8");
			connection.sqlite.exec(sqlText);
		}

		runner = new DynamicRunner(connection.db);
		repo = new DynamicRepository(connection.db);

		// Seed a test user
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "dynamic-test@example.com",
				passwordHash: "hash",
				displayName: "Dynamic User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;

		// Seed project
		const [proj] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "Dynamic Test Project",
				repoPath: "/valid/repo",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = proj.id;

		// Seed scan run
		const [srun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: now,
				completedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = srun.id;

		// Create dynamic profile config
		const config = await repo.createConfig({
			projectId,
			profileId: "test-profile-1",
			dynamicKind: "test",
			displayName: "Test Profile 1",
			commandJson: ["bun", "test"],
			writableWorkdir: true,
			allowProjectScripts: false,
			expectedArtifactsJson: ["crashes/*"],
			createdByUserId: userId,
		});
		configId = config.id;
	});

	afterEach(() => {
		connection.sqlite.close(false);
		vi.restoreAllMocks();
	});

	it("should perform dryRun successfully", async () => {
		const dryResult = await runner.dryRun({
			projectId,
			profileId: "test-profile-1",
			runner: "docker",
		});

		expect(dryResult.dryRun).toBe(true);
		expect(dryResult.profileId).toBe("test-profile-1");
		expect(dryResult.dynamicKind).toBe("test");
		expect(dryResult.command).toEqual(["bun", "test"]);
		expect(dryResult.writableWorkdir).toBe(true);
	});

	it("should run dynamic verification successfully and collect stdout/stderr", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			return {
				exited: Promise.resolve(0),
				stdout: streamText("test suite passed"),
				stderr: streamText(""),
				kill: () => {},
			} as any;
		});

		const result = await runner.run({
			projectId,
			profileId: "test-profile-1",
			runner: "docker",
			createdByUserId: userId,
		});

		expect(result.status).toBe("completed");
		expect(result.outcome).toBe("passed");
		expect(result.artifactIds).toHaveLength(2); // stdout, stderr

		// Verify DB Run state
		const dbRun = await repo.getRun(result.dynamicRunId!);
		expect(dbRun).not.toBeNull();
		expect(dbRun!.status).toBe("completed");
		expect(dbRun!.outcome).toBe("passed");

		const artifacts = await repo.listArtifacts(result.dynamicRunId!);
		expect(artifacts).toHaveLength(2);
		expect(artifacts.map((a) => a.kind)).toContain("stdout");
		expect(artifacts.map((a) => a.kind)).toContain("stderr");

		const evidence = await repo.listEvidence(result.dynamicRunId!);
		expect(evidence).toHaveLength(1);
		expect(evidence[0].kind).toBe("dynamic-test-log");
		expect(evidence[0].title).toContain("PASSED");
	});

	it("should collect fuzz crash artifacts from output directory mount", async () => {
		// Recreate config with fuzz kind
		await repo.deleteConfig(configId);
		await repo.createConfig({
			projectId,
			profileId: "test-profile-1",
			dynamicKind: "fuzz",
			displayName: "Fuzz Profile 1",
			commandJson: ["python3", "-m", "fuzz"],
			writableWorkdir: true,
			allowProjectScripts: false,
			expectedArtifactsJson: ["crashes/*"],
			createdByUserId: userId,
		});

		vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			// Simulate container writing expected artifact inside hostOutDir mount
			const mountArg = args.find((a: string) => a.includes(":/workspace/out:rw"));
			if (mountArg) {
				const hostDir = mountArg.split(":")[0];
				const crashFileDir = path.join(hostDir, "crashes");
				const fsSync = require("node:fs");
				fsSync.mkdirSync(crashFileDir, { recursive: true });
				fsSync.writeFileSync(
					path.join(crashFileDir, "crash-01.txt"),
					"crash seed payload",
					"utf8",
				);
			}

			return {
				exited: Promise.resolve(0),
				stdout: streamText("fuzzing error details"),
				stderr: streamText(""),
				kill: () => {},
			} as any;
		});

		const result = await runner.run({
			projectId,
			profileId: "test-profile-1",
			runner: "docker",
			createdByUserId: userId,
		});

		expect(result.status).toBe("completed");
		expect(result.outcome).toBe("crashed");
		expect(result.artifactIds).toHaveLength(3); // stdout, stderr, crash-01.txt

		const artifacts = await repo.listArtifacts(result.dynamicRunId!);
		expect(artifacts.map((a) => a.kind)).toContain("crash");

		const evidence = await repo.listEvidence(result.dynamicRunId!);
		expect(evidence[0].kind).toBe("fuzz-crash");
	});

	it("should classify execution failures cleanly if docker fails to start or times out", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			return {
				exited: Promise.resolve(125), // Docker CLI run error code
				stdout: streamText(""),
				stderr: streamText("docker process error: Cannot connect to the Docker daemon"),
				kill: () => {},
			} as any;
		});

		const result = await runner.run({
			projectId,
			profileId: "test-profile-1",
			runner: "docker",
			createdByUserId: userId,
		});

		expect(result.status).toBe("failed");
		expect(result.outcome).toBe("error");
		expect(result.message).toContain("Sandbox execution failed");

		const dbRun = await repo.getRun(result.dynamicRunId!);
		expect(dbRun!.status).toBe("failed");
		expect(dbRun!.outcome).toBe("error");
		expect(dbRun!.metadata.failureKind).toBe("docker_unavailable");
	});

	it("should preserve timeout as a dynamic outcome instead of a runner error", async () => {
		let resolveExit: (code: number | null) => void = () => {};
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			return {
				exited: new Promise<number | null>((resolve) => {
					resolveExit = resolve;
				}),
				stdout: streamText("still running"),
				stderr: streamText(""),
				kill: () => resolveExit(null),
			} as any;
		});

		const result = await runner.run({
			projectId,
			profileId: "test-profile-1",
			runner: "docker",
			timeoutSec: 1,
			createdByUserId: userId,
		});

		expect(result.status).toBe("timed_out");
		expect(result.outcome).toBe("timed_out");

		const dbRun = await repo.getRun(result.dynamicRunId!);
		expect(dbRun!.status).toBe("timed_out");
		expect(dbRun!.outcome).toBe("timed_out");
	});

	it("should reject request-time broadening of bounded profile policy", async () => {
		await expect(
			runner.dryRun({
				projectId,
				profileId: "test-profile-1",
				runner: "docker",
				network: "default",
			}),
		).rejects.toThrow("network mode exceeds");

		await expect(
			runner.dryRun({
				projectId,
				profileId: "test-profile-1",
				runner: "docker",
				timeoutSec: 121,
			}),
		).rejects.toThrow("exceeds the profile timeout");
	});
});
