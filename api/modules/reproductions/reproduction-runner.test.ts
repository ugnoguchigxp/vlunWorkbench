import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { findings, projects, scanRuns, users } from "../../db/schema";
import { ReproductionRepository } from "./reproduction-repository";
import { ReproductionRunner } from "./reproduction-runner";

function streamText(text: string) {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});
}

describe("Reproduction Runner", () => {
	let connection: DbConnection;
	let runner: ReproductionRunner;
	let repo: ReproductionRepository;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let findingId: string;

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

		runner = new ReproductionRunner(connection.db);
		repo = new ReproductionRepository(connection.db);

		// Seed a test user
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "test@example.com",
				passwordHash: "hash",
				displayName: "Test User",
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
				name: "Test Project",
				repoPath: "/valid/path",
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

		// Seed finding
		const [find] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: "test-rule-id",
				title: "Test finding",
				description: "Test vuln description",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/index.js", startLine: 10 },
				fingerprint: "fingerprint-abc",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId = find.id;
	});

	afterEach(() => {
		connection.sqlite.close(false);
		vi.restoreAllMocks();
	});

	it("should perform dryRun successfully", async () => {
		const dryResult = await runner.dryRun({
			findingId,
			profileId: "semgrep-path-recheck",
			runner: "docker",
		});

		expect(dryResult.dryRun).toBe(true);
		expect(dryResult.profileId).toBe("semgrep-path-recheck");
		expect(dryResult.isApplicable).toBe(true);
		expect(dryResult.command.binaryName).toBe("semgrep");
		expect(dryResult.command.args).toContain("scan");
		expect(dryResult.command.args).toContain("/valid/path");
	});

	it("should run reproduction and detect reproduced outcome", async () => {
		const semgrepResult = {
			results: [
				{
					check_id: "test-rule-id",
					path: "src/index.js",
					start: { line: 10, col: 1 },
					end: { line: 10, col: 5 },
					extra: { message: "vuln found", severity: "ERROR" },
				},
			],
		};

		vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			// Find host output directory mounted to /workspace/out
			const mountArg = args.find((a: string) => a.includes(":/workspace/out:rw"));
			if (mountArg) {
				const hostDir = mountArg.split(":")[0];
				const jsonArg = args.find(
					(a: string) => a.includes("/workspace/out/") && a.endsWith(".json"),
				);
				if (jsonArg) {
					const filename = path.basename(jsonArg);
					const hostPath = path.join(hostDir, filename);
					fs.writeFile(hostPath, JSON.stringify(semgrepResult), "utf8").catch(
						console.error,
					);
				}
			}

			return {
				exited: Promise.resolve(0),
				stdout: streamText("semgrep ran successfully"),
				stderr: streamText(""),
				kill: () => {},
			} as any;
		});

		const result = await runner.run({
			findingId,
			profileId: "semgrep-path-recheck",
			runner: "docker",
			createdByUserId: userId,
		});

		expect(result.status).toBe("completed");
		expect(result.outcome).toBe("reproduced");
		expect(result.artifactIds).toHaveLength(3);

		// Assert database records
		const dbRun = await repo.getRun(result.reproductionRunId!);
		expect(dbRun).not.toBeNull();
		expect(dbRun!.status).toBe("completed");
		expect(dbRun!.verificationKind).toBe("scanner_recheck");
		expect(dbRun!.outcome).toBe("observed");

		const artifacts = await repo.listArtifacts(result.reproductionRunId!);
		expect(artifacts).toHaveLength(3);
		expect(artifacts.map((a) => a.kind)).toContain("raw_result");
		expect(artifacts.map((a) => a.kind)).toContain("stdout");
		expect(artifacts.map((a) => a.kind)).toContain("stderr");

		const evidence = await repo.listEvidence(result.reproductionRunId!);
		expect(evidence).toHaveLength(1);
		expect(evidence[0].kind).toBe("reproduction-result");
		expect(evidence[0].title).toContain("Observed again by bounded recheck");
	});

	it("should run reproduction and detect not_reproduced outcome", async () => {
		const semgrepResult = { results: [] };

		vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			const mountArg = args.find((a: string) => a.includes(":/workspace/out:rw"));
			if (mountArg) {
				const hostDir = mountArg.split(":")[0];
				const jsonArg = args.find(
					(a: string) => a.includes("/workspace/out/") && a.endsWith(".json"),
				);
				if (jsonArg) {
					const filename = path.basename(jsonArg);
					const hostPath = path.join(hostDir, filename);
					fs.writeFile(hostPath, JSON.stringify(semgrepResult), "utf8").catch(
						console.error,
					);
				}
			}

			return {
				exited: Promise.resolve(0),
				stdout: streamText("semgrep ran successfully"),
				stderr: streamText(""),
				kill: () => {},
			} as any;
		});

		const result = await runner.run({
			findingId,
			profileId: "semgrep-path-recheck",
			runner: "docker",
		});

		expect(result.status).toBe("completed");
		expect(result.outcome).toBe("not_reproduced");

		const evidence = await repo.listEvidence(result.reproductionRunId!);
		expect(evidence[0].title).toContain("Finding not observed");
	});

	it("should handle runner execution failure", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			return {
				exited: Promise.resolve(1),
				stdout: streamText(""),
				stderr: streamText("execution timed out"),
				kill: () => {},
			} as any;
		});

		const result = await runner.run({
			findingId,
			profileId: "semgrep-path-recheck",
			runner: "docker",
		});

		expect(result.status).toBe("failed");
		expect(result.outcome).toBe("error");

		const dbRun = await repo.getRun(result.reproductionRunId!);
		expect(dbRun!.status).toBe("failed");
		expect(dbRun!.outcome).toBe("error");
	});

	it("should classify killed sandbox execution as timed_out", async () => {
		let resolveExited: (code: number) => void = () => {};

		vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			if (args.includes("rm")) {
				return {
					exited: Promise.resolve(0),
					stdout: streamText(""),
					stderr: streamText(""),
				} as any;
			}
			return {
				exited: new Promise<number>((resolve) => {
					resolveExited = resolve;
				}),
				stdout: streamText(""),
				stderr: streamText(""),
				kill: () => resolveExited(137),
			} as any;
		});

		const result = await runner.run({
			findingId,
			profileId: "semgrep-path-recheck",
			runner: "docker",
			timeoutSec: 0.001,
		});

		expect(result.status).toBe("timed_out");
		expect(result.outcome).toBe("error");

		const dbRun = await repo.getRun(result.reproductionRunId!);
		expect(dbRun!.status).toBe("timed_out");
		expect(dbRun!.outcome).toBe("error");
		expect(dbRun!.metadata.failureKind).toBe("sandbox_timeout");
	});

	it("should mark invalid raw JSON output as failed error", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			const mountArg = args.find((a: string) => a.includes(":/workspace/out:rw"));
			if (mountArg) {
				const hostDir = mountArg.split(":")[0];
				const jsonArg = args.find(
					(a: string) => a.includes("/workspace/out/") && a.endsWith(".json"),
				);
				if (jsonArg) {
					const filename = path.basename(jsonArg);
					const hostPath = path.join(hostDir, filename);
					fs.writeFile(hostPath, "{ invalid json", "utf8").catch(
						console.error,
					);
				}
			}

			return {
				exited: Promise.resolve(0),
				stdout: streamText("semgrep ran successfully"),
				stderr: streamText(""),
				kill: () => {},
			} as any;
		});

		const result = await runner.run({
			findingId,
			profileId: "semgrep-path-recheck",
			runner: "docker",
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("failed");
		expect(result.outcome).toBe("error");
		expect(result.artifactIds).toHaveLength(3);
		expect(result.evidenceIds).toHaveLength(1);

		const dbRun = await repo.getRun(result.reproductionRunId!);
		expect(dbRun!.status).toBe("failed");
		expect(dbRun!.outcome).toBe("error");
		expect(dbRun!.metadata.failureKind).toBe("tool_output_invalid");
	});
});
