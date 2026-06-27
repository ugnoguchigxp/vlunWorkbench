import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users } from "../../db/schema";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import { DastArtifactStorage } from "./dast-artifact-storage";
import { DastRepository } from "./dast-repository";
import { DastRunner } from "./dast-runner";

describe("DastRunner", () => {
	let connection: DbConnection;
	let tempDir: string;
	let projectRepo: ProjectRepository;
	let scanRepo: ScanRepository;
	let dastRepo: DastRepository;
	let userId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dast-runner-"));
		connection = createDbConnection(":memory:");
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		for (const filename of readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b))) {
			connection.sqlite.exec(readFileSync(path.join(migrationsDir, filename), "utf8"));
		}
		projectRepo = new ProjectRepository(connection.db);
		scanRepo = new ScanRepository(connection.db);
		dastRepo = new DastRepository(connection.db);
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "runner@example.com",
				passwordHash: "hash",
				displayName: "Runner User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;
	});

	afterEach(async () => {
		connection.sqlite.close(false);
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("runs HTTP baseline with mocked fetch and persists artifacts/findings", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Runner Project",
			repoPath: "/tmp/runner",
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
			allowedPathsJson: ["/"],
			maxRequests: 1,
		});
		const runner = new DastRunner(connection.db, {
			storage: new DastArtifactStorage(tempDir),
			fetchImpl: async () =>
				new Response("ok", {
					status: 200,
					headers: {
						"access-control-allow-origin": "*",
					},
				}),
		});

		const result = await runner.run({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "http-baseline",
			createdByUserId: userId,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.dastRunId).toBeTruthy();
		expect(result.artifactIds.length).toBeGreaterThanOrEqual(2);
		expect(result.findingIds.length).toBeGreaterThan(0);
		const rows = await connection.db.query.findings.findMany();
		expect(rows.some((finding) => finding.sourceTool === "dast-http")).toBe(
			true,
		);
		expect(
			await connection.db.query.dastEvidence.findMany(),
		).not.toHaveLength(0);
	});

	it("attach mode persists DAST rows without finalizing parent scan run", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Attach Project",
			repoPath: "/tmp/attach",
		});
		const scanRun = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "web-app-baseline",
			status: "running",
			createdByUserId: userId,
			metadata: { profileId: "web-app-baseline" },
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
			allowedPathsJson: ["/"],
			maxRequests: 1,
		});
		const runner = new DastRunner(connection.db, {
			storage: new DastArtifactStorage(tempDir),
			fetchImpl: async () => new Response("ok", { status: 200 }),
		});

		const result = await runner.run({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "http-baseline",
			scanRunId: scanRun.id,
			createdByUserId: userId,
			manageScanRunStatus: false,
			useStoredProfileConfig: false,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.scanRunId).toBe(scanRun.id);
		expect(result.dastRunId).toBeTruthy();

		const updatedScanRun = await scanRepo.findById(scanRun.id);
		expect(updatedScanRun?.status).toBe("running");
		expect(updatedScanRun?.completedAt).toBeNull();
		expect(updatedScanRun?.metadata).toEqual(
			expect.objectContaining({ profileId: "web-app-baseline" }),
		);

		const dastRuns = await connection.db.query.dastRuns.findMany();
		expect(dastRuns).toHaveLength(1);
		expect(dastRuns[0].scanRunId).toBe(scanRun.id);
		expect(dastRuns[0].status).toBe("completed");
	});

	it("dry-run validates without creating scan or DAST rows", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Dry Project",
			repoPath: "/tmp/dry",
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		const runner = new DastRunner(connection.db, {
			storage: new DastArtifactStorage(tempDir),
		});
		const result = await runner.dryRun({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "http-baseline",
		});
		expect(result.ok).toBe(true);
		expect(await connection.db.query.scanRuns.findMany()).toHaveLength(0);
		expect(await connection.db.query.dastRuns.findMany()).toHaveLength(0);
	});
});
