import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanArtifacts, scanReports, scanRuns, users } from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";
import * as profileRunnerModule from "./profile-runner";
import { runProfileScan } from "./profile-runner";

describe("Profile Runner Orchestration", () => {
	let tempDir: string;
	let dbFile: string;
	let dbUrl: string;
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let repoPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "profile-runner-test-"));
		dbFile = path.join(tempDir, "test.sqlite");
		dbUrl = `file:${dbFile}`;
		repoPath = path.join(tempDir, "repo");

		await fs.mkdir(repoPath, { recursive: true });

		// Run migrations on the test database
		execSync("bun run db:migrate", {
			env: { ...process.env, DATABASE_URL: dbUrl },
		});

		connection = createDbConnection(dbUrl);

		// Seed a test user
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "profile-test@example.com",
				passwordHash: "hash",
				displayName: "Profile Test User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;

		// Seed a project
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "Profile Test Project",
				repoPath,
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;
	});

	afterEach(async () => {
		if (connection) {
			await closeTestDbConnection(connection);
		}
		await fs.rm(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("should run profile scan successfully when all tools succeed", async () => {
		const spy = vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
			async (params) => {
				return {
					toolRunId: "tool-run-123",
					findingCount: 3,
					exitCode: 0,
					elapsedMs: 120,
					artifactIds: ["art-1"],
				};
			}
		);

		const result = await runProfileScan({
			db: connection.db,
			projectId,
			profileId: "baseline",
			repoPath,
			continueOnToolFailure: true,
		});

		expect(result.ok).toBe(true);
		expect(result.status).toBe("completed");
		expect(result.profileOutcome).toBe("completed");
		expect(result.toolResults).toHaveLength(3); // semgrep, gitleaks, osv
		expect(result.toolResults[0].status).toBe("completed");
		expect(result.toolResults[0].findingCount).toBe(3);

		expect(spy).toHaveBeenCalledTimes(3);
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({
				toolId: "semgrep",
				options: expect.objectContaining({
					scope: expect.objectContaining({
						intent: "source",
						includeInstalledDependencies: false,
					}),
					scopeSummary: expect.objectContaining({
						excludedRoots: expect.arrayContaining(["node_modules", "dist"]),
					}),
				}),
			}),
		);

		const [scanRun] = await connection.db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, result.scanRunId));
		expect(scanRun.metadata).toEqual(
			expect.objectContaining({
				scope: expect.objectContaining({
					scope: expect.objectContaining({ intent: "source" }),
				}),
			}),
		);
	});

	it("revalidates a Web project path before executing a profile", async () => {
		const allowedRoot = path.join(tempDir, "allowed");
		await fs.mkdir(allowedRoot);

		await expect(
			runProfileScan({
				db: connection.db,
				projectId,
				profileId: "baseline",
				repoPath,
				executionSurface: "web",
				projectAllowedRoots: [allowedRoot],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
	});

	it("should generate a final report when requested", async () => {
		vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
			async () => {
				return {
					toolRunId: "tool-run-report",
					findingCount: 0,
					exitCode: 0,
					elapsedMs: 120,
					artifactIds: [],
				};
			},
		);

		const result = await runProfileScan({
			db: connection.db,
			projectId,
			profileId: "baseline",
			repoPath,
			continueOnToolFailure: true,
			finalReport: {
				enabled: true,
				title: "基本スキャン最終レポート",
			},
		});

		expect(result.ok).toBe(true);
		expect(result.finalReport).toEqual(
			expect.objectContaining({
				ok: true,
				status: "completed",
				reportId: expect.any(String),
				artifactId: expect.any(String),
				artifactPath: expect.stringContaining("/reports/report-"),
			}),
		);

		const report = await connection.db.query.scanReports.findFirst({
			where: eq(scanReports.id, result.finalReport!.reportId!),
		});
		expect(report).toEqual(
			expect.objectContaining({
				status: "completed",
				title: "基本スキャン最終レポート",
			}),
		);

		const artifact = await connection.db.query.scanArtifacts.findFirst({
			where: eq(scanArtifacts.id, result.finalReport!.artifactId!),
		});
		expect(artifact).toEqual(
			expect.objectContaining({
				kind: "report",
				format: "markdown",
			}),
		);
	});

	it("should handle optional tool failure with completed_with_warnings status", async () => {
		const mockProfile = {
			id: "test-optional",
			name: "Test Optional Profile",
			description: "Profile for testing optional tool failure",
			enabled: true,
			defaultTimeoutSec: 100,
			tools: [
				{
					toolId: "gitleaks",
					displayName: "Gitleaks (Required)",
					required: true,
					failurePolicy: "fail_profile" as const,
				},
				{
					toolId: "trivy",
					displayName: "Trivy (Optional)",
					required: false,
					failurePolicy: "warn_and_continue" as const,
				},
			],
		};

		const profilesModule = require("./profiles");
		const getProfileSpy = vi
			.spyOn(profilesModule, "getProfileById")
			.mockReturnValue(mockProfile);

		vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
			async (params) => {
				if (params.toolId === "trivy") {
					throw new Error("Optional tool failed mock error");
				}
				return {
					toolRunId: "tool-run-gitleaks",
					findingCount: 2,
					exitCode: 0,
					elapsedMs: 50,
					artifactIds: [],
				};
			},
		);

		const result = await runProfileScan({
			db: connection.db,
			projectId,
			profileId: "test-optional",
			repoPath,
			continueOnToolFailure: true,
		});

		expect(result.ok).toBe(true);
		expect(result.status).toBe("completed");
		expect(result.profileOutcome).toBe("completed_with_warnings");
		expect(result.toolResults).toHaveLength(2);
		expect(result.toolResults[0].status).toBe("completed");
		expect(result.toolResults[1].status).toBe("failed");
		expect(result.toolResults[1].error).toBe("Optional tool failed mock error");

		getProfileSpy.mockRestore();
	});

	it("should orchestrate static and DAST steps in one profile scan", async () => {
		const mockProfile = {
			id: "web-test",
			name: "Web Test Profile",
			description: "Profile for testing unified static and DAST steps",
			enabled: true,
			defaultTimeoutSec: 100,
			tools: [
				{
					toolId: "semgrep",
					displayName: "Semgrep",
					required: true,
					failurePolicy: "fail_profile" as const,
				},
			],
			steps: [
				{
					kind: "static_tool" as const,
					toolId: "semgrep",
					displayName: "Semgrep",
					required: true,
					failurePolicy: "fail_profile" as const,
				},
				{
					kind: "dast" as const,
					profileId: "http-baseline" as const,
					displayName: "Auto DAST HTTP Baseline",
					required: false,
					failurePolicy: "warn_and_continue" as const,
					target: { mode: "auto_project_start" as const },
				},
			],
		};

		const profilesModule = require("./profiles");
		const getProfileSpy = vi
			.spyOn(profilesModule, "getProfileById")
			.mockReturnValue(mockProfile);

		const staticSpy = vi
			.spyOn(profileRunnerModule, "runToolIntoExistingScan")
			.mockImplementation(async () => ({
				toolRunId: "tool-run-semgrep",
				findingCount: 1,
				exitCode: 0,
				elapsedMs: 50,
				artifactIds: [],
			}));
		const dastSpy = vi
			.spyOn(profileRunnerModule, "runDastStepIntoExistingScan")
			.mockImplementation(async () => ({
				kind: "dast",
				profileId: "http-baseline",
				required: false,
				status: "completed",
				outcome: "passed",
				findingCount: 0,
				dastRunId: "dast-run-1",
				targetOrigin: "http://127.0.0.1:3000",
				error: null,
			}));

		const result = await runProfileScan({
			db: connection.db,
			projectId,
			profileId: "web-test",
			repoPath,
			continueOnToolFailure: true,
		});

		expect(result.ok).toBe(true);
		expect(result.profileOutcome).toBe("completed");
		expect(result.toolResults).toHaveLength(1);
		expect(result.stepResults).toHaveLength(2);
		expect(result.stepResults[0]).toEqual(
			expect.objectContaining({ kind: "static_tool", toolId: "semgrep" }),
		);
		expect(result.stepResults[1]).toEqual(
			expect.objectContaining({
				kind: "dast",
				profileId: "http-baseline",
				dastRunId: "dast-run-1",
			}),
		);
		expect(staticSpy).toHaveBeenCalledTimes(1);
		expect(dastSpy).toHaveBeenCalledTimes(1);

		const [scanRun] = await connection.db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, result.scanRunId));
		expect(scanRun.metadata).toEqual(
			expect.objectContaining({
				stepOrder: ["semgrep", "dast:http-baseline"],
				stepResults: expect.arrayContaining([
					expect.objectContaining({ kind: "dast", dastRunId: "dast-run-1" }),
				]),
			}),
		);

		getProfileSpy.mockRestore();
	});

	it("should fail profile when a fail_profile tool is marked optional", async () => {
		const mockProfile = {
			id: "test-fail-policy",
			name: "Test Failure Policy Profile",
			description: "Profile for testing fail_profile policy",
			enabled: true,
			defaultTimeoutSec: 100,
			tools: [
				{
					toolId: "gitleaks",
					displayName: "Gitleaks Optional But Blocking",
					required: false,
					failurePolicy: "fail_profile" as const,
				},
				{
					toolId: "trivy",
					displayName: "Trivy Optional Warning",
					required: false,
					failurePolicy: "warn_and_continue" as const,
				},
			],
		};

		const profilesModule = require("./profiles");
		const getProfileSpy = vi
			.spyOn(profilesModule, "getProfileById")
			.mockReturnValue(mockProfile);

		vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
			async (params) => {
				if (params.toolId === "gitleaks") {
					throw new Error("Policy-blocking optional tool failed");
				}
				return {
					toolRunId: "tool-run-trivy",
					findingCount: 1,
					exitCode: 0,
					elapsedMs: 50,
					artifactIds: [],
				};
			},
		);

		const result = await runProfileScan({
			db: connection.db,
			projectId,
			profileId: "test-fail-policy",
			repoPath,
			continueOnToolFailure: true,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("failed");
		expect(result.profileOutcome).toBe("failed");
		expect(result.toolResults).toHaveLength(2);
		expect(result.toolResults[0].required).toBe(false);
		expect(result.toolResults[0].status).toBe("failed");
		expect(result.toolResults[1].status).toBe("completed");

		getProfileSpy.mockRestore();
	});

	it("should stop execution on required tool failure when continueOnToolFailure is false", async () => {
		const runToolSpy = vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
			async (params) => {
				if (params.toolId === "semgrep") {
					throw new Error("Required tool failed mock error");
				}
				return {
					toolRunId: "tool-run-ok",
					findingCount: 1,
					exitCode: 0,
					elapsedMs: 50,
					artifactIds: [],
				};
			}
		);

		const result = await runProfileScan({
			db: connection.db,
			projectId,
			profileId: "baseline",
			repoPath,
			continueOnToolFailure: false,
		});

		expect(result.ok).toBe(false);
		expect(result.status).toBe("failed");
		expect(result.profileOutcome).toBe("failed");
		expect(result.toolResults[0].status).toBe("failed");
		expect(result.toolResults[1].status).toBe("skipped"); // gitleaks skipped
	});

	it("should run runToolIntoExistingScan directly with mocked Bun.spawn for Gitleaks", async () => {
		const { ArtifactStorage } = require("./artifact-storage");
		const storage = new ArtifactStorage(tempDir);

		const spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			const binary = args[0];
			if (binary === "gitleaks") {
				if (args.includes("version")) {
					return {
						exited: Promise.resolve(0),
						stdout: new Response("8.18.0\n"),
						stderr: new Response(""),
					} as any;
				}
				// Mock detect run
				const repIdx = args.indexOf("--report-path");
				if (repIdx !== -1 && args[repIdx + 1]) {
					const repPath = args[repIdx + 1];
					const mockResult = [
						{
							RuleID: "generic-api-key",
							Description: "Generic API Key Leak",
							File: "src/keys.txt",
							StartLine: 5,
							EndLine: 5,
							Secret: "x".repeat(32),
						}
					];
					require("node:fs").writeFileSync(repPath, JSON.stringify(mockResult, null, 2), "utf8");
				}
				return {
					exited: Promise.resolve(1),
					stdout: new Response(""),
					stderr: new Response(""),
				} as any;
			}
			return {
				exited: Promise.resolve(0),
				stdout: new Response(""),
				stderr: new Response(""),
			} as any;
		});

		const now = new Date();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "running",
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		const result = await profileRunnerModule.runToolIntoExistingScan({
			db: connection.db,
			projectId,
			scanRunId: scanRun.id,
			toolId: "gitleaks",
			artifactStorage: storage,
			repoPath,
		});

		expect(result.toolRunId).toBeTruthy();
		expect(result.exitCode).toBe(1);
		expect(result.findingCount).toBe(1);
		expect(result.artifactIds.length).toBeGreaterThanOrEqual(1);

		spawnSpy.mockRestore();
	});
});
