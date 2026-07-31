import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users } from "../../db/schema";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import { DastArtifactStorage } from "./dast-artifact-storage";
import { MockBrowserAdapter } from "./browser-runner";
import { ArtifactStorage } from "../scans/artifact-storage";
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

	it("runs standard HTTP DAST and persists policy, coverage, events, artifacts, and findings", async () => {
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
			scanStorage: new ArtifactStorage(tempDir),
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
			profileId: "web-passive-standard",
			createdByUserId: userId,
		});

		expect(result.ok, result.ok ? undefined : result.message).toBe(true);
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
		const findingEvidence =
			await connection.db.query.findingEvidences.findMany();
		const scanArtifacts = await connection.db.query.scanArtifacts.findMany();
		expect(findingEvidence).not.toHaveLength(0);
		expect(findingEvidence.every((evidence) => evidence.artifactId)).toBe(true);
		expect(
			findingEvidence.every((evidence) =>
				scanArtifacts.some((artifact) => artifact.id === evidence.artifactId),
			),
		).toBe(true);
		const [dastRun] = await connection.db.query.dastRuns.findMany();
		expect(dastRun).toEqual(
			expect.objectContaining({
				policyId: "dast-standard-v1",
				policyHash:
					"sha256:4bee9b2e3d724fc118eae393c8e12f9f3d92b8e52c5fe69524d6e576dbaa71c9",
				verdict: "findings",
				coverageStatus: "partial",
			}),
		);
		const eventTypes = (
			await connection.db.query.scanEvents.findMany()
		).map((event) => event.eventType);
		expect(eventTypes).toEqual(
			expect.arrayContaining([
				"dast.discovery.started",
				"dast.discovery.completed",
				"dast.coverage.partial",
				"dast.verdict.finalized",
				"dast.completed",
			]),
		);
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
			scanStorage: new ArtifactStorage(tempDir),
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
			scanStorage: new ArtifactStorage(tempDir),
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

	it("stores browser screenshots separately from the JSON raw result", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Browser Artifact Project",
			repoPath: "/tmp/browser-artifact",
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
			allowedPathsJson: ["/app"],
			maxRequests: 1,
		});
		await dastRepo.createProfileConfig({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "browser-smoke",
			displayName: "Browser smoke",
			routePathsJson: ["/app"],
		});
		const storage = new DastArtifactStorage(tempDir);
		const runner = new DastRunner(connection.db, {
			storage,
			scanStorage: new ArtifactStorage(tempDir),
			browserAdapter: new MockBrowserAdapter({
				"/app": {
					screenshot: {
						filename: "app.png",
						bytes: new Uint8Array([1, 2, 3]),
					},
				},
			}),
		});

		const result = await runner.run({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "browser-smoke",
			createdByUserId: userId,
		});

		expect(result.ok).toBe(true);
		const artifacts = await connection.db.query.dastArtifacts.findMany();
		const raw = artifacts.find((artifact) => artifact.kind === "raw_result");
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(
			await storage.readTextArtifact(raw?.path as string),
		);
		expect(parsed.routes[0].screenshot).toEqual({
			filename: "app.png",
			sizeBytes: 3,
		});
		expect(JSON.stringify(parsed)).not.toContain('"bytes"');
		expect(
			artifacts.some((artifact) => artifact.kind === "screenshot"),
		).toBe(true);
		const [scanRaw] = await connection.db.query.scanArtifacts.findMany();
		expect(
			await new ArtifactStorage(tempDir).readTextArtifact(scanRaw.path),
		).toContain('"kind": "browser"');
	});

	it("rejects a profile config that belongs to another DAST profile", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Mismatched Profile Project",
			repoPath: "/tmp/mismatched-profile",
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
			allowedPathsJson: ["/app"],
		});
		const config = await dastRepo.createProfileConfig({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "browser-smoke",
			displayName: "Browser smoke",
			routePathsJson: ["/app"],
		});
		const runner = new DastRunner(connection.db);

		const result = await runner.dryRun({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "http-baseline",
			profileConfigId: config.id,
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected rejection");
		expect(result.message).toContain("does not match");
	});

	it("rejects the misleading docker option for built-in DAST profiles", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Docker Option Project",
			repoPath: "/tmp/docker-option",
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		const runner = new DastRunner(connection.db);

		const result = await runner.dryRun({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "http-baseline",
			runner: "docker",
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected rejection");
		expect(result.message).toContain("require the host runner");
	});
});
