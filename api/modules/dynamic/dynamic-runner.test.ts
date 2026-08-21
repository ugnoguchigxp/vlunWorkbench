import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	findings,
	projects,
	scanResourceLeases,
	scanRuns,
	users,
} from "../../db/schema";
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

function mockDockerSpawn(implementation: (args: string[]) => unknown) {
	const originalSpawn = Bun.spawn;
	vi.spyOn(Bun, "spawn").mockImplementation((args: unknown, ...rest: any[]) => {
		if (!Array.isArray(args) || args[0] !== "docker") {
			return originalSpawn(args as never, ...rest) as never;
		}
		return implementation(args) as never;
	});
}

const QUALIFIED_DYNAMIC_IMAGE = `example.invalid/dynamic@sha256:${"a".repeat(64)}`;

describe("Dynamic Runner", () => {
	let connection: DbConnection;
	let runner: DynamicRunner;
	let repo: DynamicRepository;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let configId: string;
	let tempDir: string;
	let repoPath: string;

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

		runner = new DynamicRunner(connection.db, {
			qualifiedDynamicImage: QUALIFIED_DYNAMIC_IMAGE,
		});
		repo = new DynamicRepository(connection.db);
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dynamic-runner-test-"));
		repoPath = path.join(tempDir, "repo");
		await fs.mkdir(repoPath);
		await fs.writeFile(path.join(repoPath, "package.json"), "{}");
		await fs.writeFile(path.join(repoPath, "package-lock.json"), '{"lockfileVersion":3,"packages":{}}');
		await fs.writeFile(path.join(repoPath, ".env"), "DATABASE_URL=host-db");
		execFileSync("git", ["init"], { cwd: repoPath });
		execFileSync("git", ["add", "."], { cwd: repoPath });
		execFileSync("git", ["-c", "user.email=dynamic@example.invalid", "-c", "user.name=Dynamic Test", "commit", "-m", "fixture"], { cwd: repoPath });

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
				repoPath,
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

	afterEach(async () => {
		connection.sqlite.close(false);
		vi.restoreAllMocks();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("requires explicit execution consent at the runner boundary", async () => {
		await expect(
			runner.run({
				projectId,
				profileId: "test-profile-1",
				runner: "docker",
				executionConsent: false as true,
			}),
		).rejects.toThrow("dynamic_execution_consent_required");
	});

	it("fails closed unless the Dynamic image is server-configured and digest-pinned", async () => {
		const unconfiguredRunner = new DynamicRunner(connection.db);
		await expect(
			unconfiguredRunner.dryRun({
				projectId,
				profileId: "test-profile-1",
				runner: "docker",
			}),
		).rejects.toThrow("dynamic_image_not_qualified");

		await expect(
			runner.dryRun({
				projectId,
				profileId: "test-profile-1",
				runner: "docker",
				dockerImage: "attacker.invalid/untrusted:latest",
			}),
		).rejects.toThrow("dynamic_image_override_rejected");
	});

	it("rejects a parent scan with the wrong canonical profile", async () => {
		await expect(
			runner.run({
				projectId,
				profileId: "test-profile-1",
				scanRunId,
				runner: "docker",
				executionConsent: true,
			}),
		).rejects.toThrow("dynamic_parent_scan_invalid");
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

	it("allows resource overrides to tighten but not broaden profile limits", async () => {
		await repo.updateConfig(configId, { memory: "2g", cpus: "2" });

		const tightened = await runner.dryRun({
			projectId,
			profileId: "test-profile-1",
			runner: "docker",
			memory: "1g",
			cpus: "1",
		});
		expect(tightened.memory).toBe("1g");
		expect(tightened.cpus).toBe("1");

		await expect(
			runner.dryRun({
				projectId,
				profileId: "test-profile-1",
				runner: "docker",
				memory: "4g",
			}),
		).rejects.toThrow("must not exceed the saved profile limit");
		await expect(
			runner.dryRun({
				projectId,
				profileId: "test-profile-1",
				runner: "docker",
				cpus: "3",
			}),
		).rejects.toThrow("must not exceed the saved profile limit");
	});

	it("should run dynamic verification successfully and collect stdout/stderr", async () => {
		let dockerArgs: string[] = [];
		mockDockerSpawn((args) => {
			if (args.includes("run")) dockerArgs = args;
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
			executionConsent: true,
			createdByUserId: userId,
		});

		expect(result.status).toBe("completed");
		expect(result.outcome).toBe("passed");
		expect(result.artifactIds).toHaveLength(2); // stdout, stderr
		expect(dockerArgs).toContain(
			"PATH=/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin",
		);
		expect(dockerArgs).toContain("--memory");
		expect(dockerArgs).toContain("--memory-swap");
		expect(dockerArgs).toContain("--cpus");
		expect(dockerArgs).toContain("--pids-limit");
		expect(dockerArgs).not.toContain(
			`${path.resolve(repoPath)}:/workspace/repo:ro`,
		);
		expect(dockerArgs).toContain("--mount");
		expect(
			dockerArgs.some((arg) =>
				arg.startsWith("type=volume,src=vuln-workbench-dyn-"),
			),
		).toBe(true);

		// Verify DB Run state
		const dbRun = await repo.getRun(result.dynamicRunId!);
		expect(dbRun).not.toBeNull();
		expect(dbRun!.status).toBe("completed");
		expect(dbRun!.outcome).toBe("passed");
		expect(dbRun!.metadata.runtimeProjection).toEqual(
			expect.objectContaining({
				policyVersion: 1,
				sourceRevision: expect.stringMatching(/^[a-f0-9]{40}$/),
				sourceSnapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
			}),
		);

		const artifacts = await repo.listArtifacts(result.dynamicRunId!);
		expect(artifacts).toHaveLength(2);
		expect(artifacts.map((a) => a.kind)).toContain("stdout");
		expect(artifacts.map((a) => a.kind)).toContain("stderr");

		const evidence = await repo.listEvidence(result.dynamicRunId!);
		expect(evidence).toHaveLength(1);
		expect(evidence[0].kind).toBe("dynamic-test-log");
		expect(evidence[0].title).toContain("PASSED");
	});

	it("binds and releases a dynamic bundle lease under a valid parent scan", async () => {
		const now = new Date();
		const [parent] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "dynamic-verification",
				status: "running",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		mockDockerSpawn(() => ({
			exited: Promise.resolve(0),
			stdout: streamText("passed"),
			stderr: streamText(""),
			kill: () => {},
		}) as any);

		const result = await runner.run({
			projectId,
			profileId: "test-profile-1",
			scanRunId: parent!.id,
			runner: "docker",
			executionConsent: true,
		});
		expect(result.status).toBe("completed");
		const [lease] = await connection.db
			.select()
			.from(scanResourceLeases)
			.where(
				eq(scanResourceLeases.scanRunId, parent!.id),
			);
		expect(lease).toMatchObject({
			provider: "docker-dynamic-isolation",
			resourceType: "dynamic_bundle",
			state: "released",
			receipt: expect.objectContaining({ releasedAt: expect.any(String) }),
		});
	});

	it("fails closed and retains only bounded process output", async () => {
		runner = new DynamicRunner(connection.db, {
			qualifiedDynamicImage: QUALIFIED_DYNAMIC_IMAGE,
			outputLimits: { stdoutBytes: 4, stderrBytes: 4 },
		});
		vi.spyOn(Bun, "spawnSync").mockImplementation(() => ({}) as never);
		mockDockerSpawn((args) => {
			if (!args.includes("run")) {
				return {
					exited: Promise.resolve(0),
					stdout: streamText(""),
					stderr: streamText(""),
					kill: () => {},
				} as any;
			}
			return {
				exited: Promise.resolve(137),
				stdout: streamText("12345"),
				stderr: streamText(""),
				kill: () => {},
			} as any;
		});

		const result = await runner.run({
			projectId,
			profileId: "test-profile-1",
			runner: "docker",
			executionConsent: true,
			createdByUserId: userId,
		});

		expect(result.status).toBe("failed");
		expect(result.message).toContain("dynamic_output_limit_exceeded");
		const dbRun = await repo.getRun(result.dynamicRunId!);
		expect(dbRun?.metadata.failureKind).toBe("dynamic_output_limit_exceeded");
		const artifacts = await repo.listArtifacts(result.dynamicRunId!);
		const stdout = artifacts.find((artifact) => artifact.kind === "stdout");
		expect(stdout?.sizeBytes).toBe(4);
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

		mockDockerSpawn((args) => {
			// The collector copies only from the server-owned output volume.
			if (args.includes("cp")) {
				const hostDir = args.at(-1);
				if (!hostDir) throw new Error("missing_dynamic_output_directory");
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
			executionConsent: true,
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
		mockDockerSpawn((args) => {
			if (!args.includes("run")) {
				return { exited: Promise.resolve(0), stdout: streamText(""), stderr: streamText(""), kill: () => {} } as any;
			}
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
			executionConsent: true,
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

	it(
		"should preserve timeout as a dynamic outcome instead of a runner error",
		async () => {
			let resolveExit: (code: number | null) => void = () => {};
			mockDockerSpawn((args) => {
				if (!args.includes("run")) return { exited: Promise.resolve(0), stdout: streamText(""), stderr: streamText(""), kill: () => {} } as any;
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
				executionConsent: true,
				timeoutSec: 1,
				createdByUserId: userId,
			});

			expect(result.status).toBe("timed_out");
			expect(result.outcome).toBe("timed_out");

			const dbRun = await repo.getRun(result.dynamicRunId!);
			expect(dbRun!.status).toBe("timed_out");
			expect(dbRun!.outcome).toBe("timed_out");
		},
		15_000,
	);

	it("should reject request-time broadening of bounded profile policy", async () => {
		await expect(
			runner.dryRun({
				projectId,
				profileId: "test-profile-1",
				runner: "docker",
				network: "default",
			}),
		).rejects.toThrow("qualified runtime bundle");

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
