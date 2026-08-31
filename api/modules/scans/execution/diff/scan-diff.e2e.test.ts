import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../../../db";
import {
	findings,
	projects,
	scanArtifacts,
	scanRuns,
	toolRuns,
	users,
} from "../../../../db/schema";
import { closeTestDbConnection } from "../../../../db/testing/connection";
import { ArtifactStorage } from "../lifecycle/artifact-storage";
import { runGitText } from "./git-command";
import { runProfileScan } from "../profile-orchestrator";

describe("Git diff scan E2E", () => {
	let tempRoot: string;
	let repoPath: string;
	let artifactRoot: string;
	let connection: DbConnection;
	let projectId: string;
	let previousArtifactRoot: string | undefined;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scan-diff-e2e-"));
		repoPath = path.join(tempRoot, "repo");
		artifactRoot = path.join(tempRoot, "artifacts");
		const dbUrl = `file:${path.join(tempRoot, "test.sqlite")}`;
		await fs.mkdir(repoPath);
		execSync("bun run db:migrate", {
			cwd: process.cwd(),
			env: { ...process.env, DATABASE_URL: dbUrl },
		});
		connection = createDbConnection(dbUrl);
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "diff-e2e@example.com",
				passwordHash: "hash",
				displayName: "Diff E2E",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: user.id,
				name: "Diff E2E",
				repoPath,
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;

		git(["init", "-b", "main"]);
		git(["config", "user.email", "test@example.com"]);
		git(["config", "user.name", "Test User"]);
		await write("src/app.ts", "export const safe = true;\n");
		await write("secrets.txt", "placeholder\n");
		git(["add", "-A"]);
		git(["commit", "-m", "base"]);
		await write("src/app.ts", "eval(userInput);\n");
		await write("secrets.txt", "super-secret-value\n");

		previousArtifactRoot = process.env.SCAN_ARTIFACT_ROOT;
		process.env.SCAN_ARTIFACT_ROOT = artifactRoot;
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (previousArtifactRoot === undefined) {
			delete process.env.SCAN_ARTIFACT_ROOT;
		} else {
			process.env.SCAN_ARTIFACT_ROOT = previousArtifactRoot;
		}
		await closeTestDbConnection(connection);
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("runs changed-file scanners through an immutable working-tree snapshot", async () => {
		const originalSpawn = Bun.spawn.bind(Bun);
		vi.spyOn(Bun, "spawn").mockImplementation((args, options) => {
			if (!Array.isArray(args)) {
				return originalSpawn(args, options);
			}
			const argv = args as string[];
			const binary = argv[0];
			if (path.basename(binary) === "git") {
				return originalSpawn(args, options);
			}
			if (binary === "gitleaks" && argv[1] === "version") {
				return processResult(0, "8.30.1\n");
			}
			if (binary === "trivy" && argv[1] === "--version") {
				return processResult(0, "Version: 0.72.0\n");
			}
			if (binary === "osv-scanner" && argv[1] === "--version") {
				return processResult(0, "osv-scanner version: 2.4.0\n");
			}

			if (binary === "gitleaks") {
				const outputPath = argv[argv.indexOf("--report-path") + 1];
				const sourcePath = argv[argv.indexOf("--source") + 1];
				expect(argv).toContain("--no-git");
				const writeResult = fs.writeFile(
					outputPath,
					JSON.stringify([
						{
							Description: "Test secret",
							StartLine: 1,
							EndLine: 1,
							File: path.join(sourcePath, "secrets.txt"),
							Secret: "super-secret-value",
							RuleID: "test-secret",
						},
					]),
				);
				return processResult(1, `scanned ${sourcePath}`, writeResult);
			}

			if (binary === "trivy") {
				const outputPath = argv[argv.indexOf("--output") + 1];
				return processResult(
					0,
					"",
					fs.writeFile(
						outputPath,
						JSON.stringify({ SchemaVersion: 2, Results: [] }),
					),
				);
			}
			throw new Error(`Unexpected process: ${argv.join(" ")}`);
		});

		const result = await runProfileScan({
			db: connection.db,
			projectId,
			profileId: "diff-source-baseline",
			repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			continueOnToolFailure: true,
		});
		expect(result.ok).toBe(true);
		expect(result.profileOutcome).toBe("completed");
		expect(
			result.toolResults.find((tool) => tool.toolId === "osv"),
		).toMatchObject({
			status: "skipped",
			reasonCode: "no_dependency_manifest_changed",
		});
		const persistedFindings = await connection.db
			.select()
			.from(findings)
			.where(eq(findings.scanRunId, result.scanRunId));
		expect(persistedFindings).toHaveLength(1);
		expect(
			persistedFindings.map((finding) => finding.primaryLocation),
		).toEqual(
			expect.arrayContaining([
					expect.objectContaining({ path: "secrets.txt" }),
			]),
		);
		expect(
			persistedFindings.every(
				(finding) =>
					(finding.metadata?.diffRelation as Record<string, unknown>)?.kind ===
					"changed_file",
			),
		).toBe(true);

		const [scanRun] = await connection.db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, result.scanRunId));
		expect(scanRun.metadata).toEqual(
			expect.objectContaining({
				target: expect.objectContaining({
					kind: "working_tree",
					targetDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				}),
				diffCoverage: expect.objectContaining({
					changed: 2,
					scannable: 2,
				}),
			}),
		);
		const artifacts = await connection.db
			.select()
			.from(scanArtifacts)
			.where(eq(scanArtifacts.scanRunId, result.scanRunId));
		const manifest = artifacts.find(
			(artifact) => artifact.kind === "diff_manifest",
		);
		expect(manifest).toBeDefined();
		const manifestText = await new ArtifactStorage(artifactRoot).readTextArtifact(
			manifest?.path ?? "",
		);
		expect(manifestText).not.toContain("eval(userInput)");
		expect(manifestText).not.toContain("super-secret-value");
		expect(manifestText).not.toContain(tempRoot);
		for (const artifact of artifacts.filter(
			(item) => item.format === "json" || item.format === "text",
		)) {
			const artifactText = await new ArtifactStorage(
				artifactRoot,
			).readTextArtifact(artifact.path);
			expect(artifactText).not.toContain(tempRoot);
			expect(artifactText).not.toContain("vuln-workbench-diff-");
			expect(artifactText).not.toContain("super-secret-value");
		}

		const persistedToolRuns = await connection.db
			.select()
			.from(toolRuns)
			.where(eq(toolRuns.scanRunId, result.scanRunId));
		expect(
			persistedToolRuns.every(
				(toolRun) =>
					typeof toolRun.metadata?.scanTarget === "object" &&
					typeof toolRun.metadata?.diffInputKind === "string",
			),
		).toBe(true);
		expect(await fs.readFile(path.join(repoPath, "src/app.ts"), "utf8")).toBe(
			"eval(userInput);\n",
		);
		expect(await fs.readFile(path.join(repoPath, "secrets.txt"), "utf8")).toBe(
			"super-secret-value\n",
		);
		const status = await runGitText({
			cwd: repoPath,
			args: ["status", "--short"],
		});
		expect(status).toContain("src/app.ts");
		expect(status).toContain("secrets.txt");
	});

	function git(args: string[]): string {
		return execFileSync("git", args, { cwd: repoPath, encoding: "utf8" });
	}

	async function write(relativePath: string, content: string): Promise<void> {
		const absolutePath = path.join(repoPath, relativePath);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, content);
	}
});

function processResult(
	exitCode: number,
	stdout: string,
	beforeExit: Promise<unknown> = Promise.resolve(),
	stderr = "",
) {
	return {
		exited: beforeExit.then(() => exitCode),
		stdout: new Response(stdout).body,
		stderr: new Response(stderr).body,
		kill: () => undefined,
	} as never;
}
