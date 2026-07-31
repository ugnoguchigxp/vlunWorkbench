import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users } from "../../db/schema";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import { DastRepository } from "./dast-repository";

describe("DastRepository", () => {
	let connection: DbConnection;
	let dastRepo: DastRepository;
	let projectRepo: ProjectRepository;
	let scanRepo: ScanRepository;
	let userId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		for (const filename of readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b))) {
			connection.sqlite.exec(readFileSync(path.join(migrationsDir, filename), "utf8"));
		}
		dastRepo = new DastRepository(connection.db);
		projectRepo = new ProjectRepository(connection.db);
		scanRepo = new ScanRepository(connection.db);
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "dast@example.com",
				passwordHash: "hash",
				displayName: "DAST User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;
	});

	afterEach(() => {
		connection.sqlite.close(false);
	});

	it("persists DAST target, profile, run, artifact, and evidence rows", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "DAST Project",
			repoPath: "/tmp/project",
		});
		const scanRun = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "dast:http-baseline",
			status: "running",
			createdByUserId: userId,
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
			createdByUserId: userId,
		});
		const profile = await dastRepo.createProfileConfig({
			projectId: project.id,
			targetConfigId: target.id,
			profileId: "http-baseline",
			displayName: "HTTP Baseline",
			routePathsJson: ["/"],
		});
		const run = await dastRepo.createRun({
			projectId: project.id,
			scanRunId: scanRun.id,
			targetConfigId: target.id,
			profileConfigId: profile.id,
			profileId: "http-baseline",
			dastKind: "http",
			targetOrigin: target.normalizedOrigin,
			runnerOrigin: target.normalizedOrigin,
			status: "running",
		});
		const artifact = await dastRepo.createArtifact({
			dastRunId: run.id,
			projectId: project.id,
			scanRunId: scanRun.id,
			kind: "raw_result",
			format: "json",
			path: `${run.id}/raw/raw-result.json`,
			sha256: "abc",
			sizeBytes: 10,
		});
		const evidence = await dastRepo.createEvidence({
			dastRunId: run.id,
			projectId: project.id,
			scanRunId: scanRun.id,
			kind: "http-response",
			title: "HTTP 200",
			artifactId: artifact.id,
			snippet: "status=200",
		});
		await dastRepo.replaceRouteInventory({
			dastRunId: run.id,
			projectId: project.id,
			scanRunId: scanRun.id,
			entries: [
				{
					method: "GET",
					path: "/",
					queryKeys: [],
					queryShapeHash: "empty",
					sources: ["configured"],
					depth: 0,
					required: true,
					authMode: "anonymous",
					state: "succeeded",
					statusCode: 200,
					limitationCode: null,
				},
			],
		});

		expect((await dastRepo.listTargetConfigsForProject(project.id))).toHaveLength(1);
		expect((await dastRepo.listProfileConfigsForProject(project.id))).toHaveLength(1);
		expect((await dastRepo.listRunsForProject(project.id))[0].id).toBe(run.id);
		expect((await dastRepo.listArtifacts(run.id))[0].id).toBe(artifact.id);
		expect((await dastRepo.listEvidence(run.id))[0].id).toBe(evidence.id);
		expect(await dastRepo.listRouteInventory(run.id)).toEqual([
			expect.objectContaining({
				path: "/",
				state: "succeeded",
				sources: ["configured"],
			}),
		]);
	});

	it("stores the same profile independently for different targets", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Multi-target DAST Project",
			repoPath: "/tmp/multi-target-project",
		});
		const firstTarget = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "first",
			origin: "http://127.0.0.1:3001",
		});
		const secondTarget = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "second",
			origin: "http://127.0.0.1:3002",
		});
		const first = await dastRepo.createProfileConfig({
			projectId: project.id,
			targetConfigId: firstTarget.id,
			profileId: "browser-smoke",
			displayName: "First browser profile",
			routePathsJson: ["/first"],
		});
		const second = await dastRepo.createProfileConfig({
			projectId: project.id,
			targetConfigId: secondTarget.id,
			profileId: "browser-smoke",
			displayName: "Second browser profile",
			routePathsJson: ["/second"],
		});

		expect(
			await dastRepo.getProfileConfigForTarget(
				project.id,
				firstTarget.id,
				"browser-smoke",
			),
		).toEqual(expect.objectContaining({ id: first.id }));
		expect(
			await dastRepo.getProfileConfigForTarget(
				project.id,
				secondTarget.id,
				"browser-smoke",
			),
		).toEqual(expect.objectContaining({ id: second.id }));
	});
});
