import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	dynamicProfileConfigs,
	dynamicRuns,
	projectDeletionCleanupJobs,
	scanEvents,
	scanReports,
	users,
} from "../../db/schema";
import { ProjectArtifactCleanupRunner } from "./project-artifact-cleanup-runner";
import { ProjectDeletionCleanupRepository } from "./project-deletion-cleanup-repository";
import { ProjectRepository, ScanRepository } from "./repositories";
import { ScanDeletionService } from "./scan-deletion-service";

describe("ScanDeletionService", () => {
	let connection: DbConnection;
	let userId: string;
	let projectRepository: ProjectRepository;
	let scanRepository: ScanRepository;
	let cleanupRepository: ProjectDeletionCleanupRepository;
	let cleanupRunner: ProjectArtifactCleanupRunner;
	let service: ScanDeletionService;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const filename of readdirSync(path.resolve(process.cwd(), "drizzle"))
			.filter((file) => file.endsWith(".sql"))
			.sort((left, right) => left.localeCompare(right))) {
			connection.sqlite.exec(
				readFileSync(path.resolve(process.cwd(), "drizzle", filename), "utf8"),
			);
		}
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "scan-delete-test@example.com",
				passwordHash: "hash",
				displayName: "Scan Delete Test",
				role: "member",
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning();
		if (!user) throw new Error("test user was not created");
		userId = user.id;
		projectRepository = new ProjectRepository(connection.db);
		scanRepository = new ScanRepository(connection.db);
		cleanupRepository = new ProjectDeletionCleanupRepository(connection.db);
		cleanupRunner = new ProjectArtifactCleanupRunner(
			cleanupRepository,
			{
				scanStorage: { removeRunDirectory: vi.fn(async () => {}) },
				dastStorage: { removeRunDirectory: vi.fn(async () => {}) },
				dynamicStorage: { removeRunDirectory: vi.fn(async () => {}) },
				reproductionStorage: { removeRunDirectory: vi.fn(async () => {}) },
			},
		);
		vi.spyOn(cleanupRunner, "enqueue").mockImplementation(() => {});
		service = new ScanDeletionService({
			db: connection.db,
			projectRepository,
			scanRepository,
			cleanupRunner,
		});
	});

	async function createDynamicRun(projectId: string, scanRunId: string) {
		const [dynamicProfile] = await connection.db
			.insert(dynamicProfileConfigs)
			.values({
				projectId,
				profileId: `delete-test-${scanRunId}`,
				dynamicKind: "test",
				displayName: "Delete test",
				commandJson: ["bun", "test"],
			})
			.returning();
		if (!dynamicProfile) throw new Error("dynamic profile was not created");
		const [dynamicRun] = await connection.db
			.insert(dynamicRuns)
			.values({
				projectId,
				scanRunId,
				profileConfigId: dynamicProfile.id,
				profileId: dynamicProfile.profileId,
				dynamicKind: dynamicProfile.dynamicKind,
				status: "completed",
				commandJson: ["bun", "test"],
			})
			.returning();
		if (!dynamicRun) throw new Error("dynamic run was not created");
		return dynamicRun;
	}

	afterEach(() => {
		connection.sqlite.close();
	});

	it("deletes a terminal owned scan and its cascaded records", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/code",
		});
		const scan = await scanRepository.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "completed",
		});
		const dynamicRun = await createDynamicRun(project.id, scan.id);
		await scanRepository.createScanEvent({
			scanRunId: scan.id,
			level: "info",
			eventType: "scan.completed",
			message: "completed",
		});

		const result = await service.deleteOwnedScan({
			scanRunId: scan.id,
			userId,
		});

		expect(result).toMatchObject({
			deletedScanRunId: scan.id,
			artifactCleanup: "queued",
		});
		expect(cleanupRunner.enqueue).toHaveBeenCalledWith(`scan-run:${scan.id}`);
		expect(await cleanupRepository.findById(`scan-run:${scan.id}`)).toMatchObject({
			status: "pending",
			projectId: project.id,
			manifest: {
				scanRunIds: [scan.id],
				dastRunIds: [],
				dynamicRunIds: [dynamicRun.id],
				reproductionRunIds: [],
			},
		});
		expect(await scanRepository.findById(scan.id)).toBeNull();
		expect(await connection.db.select().from(dynamicRuns)).toHaveLength(0);
		expect(await connection.db.select().from(scanEvents)).toHaveLength(0);
	});

	it("refuses deletion while the scan is queued or running", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/code",
		});
		const scan = await scanRepository.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "running",
		});

		await expect(
			service.deleteOwnedScan({ scanRunId: scan.id, userId }),
		).rejects.toMatchObject({
			status: 409,
			code: "SCAN_HAS_ACTIVE_WORK",
			details: { activeWork: [{ kind: "scan_runs", count: 1 }] },
		});
		expect(cleanupRunner.enqueue).not.toHaveBeenCalled();
		expect(await scanRepository.findById(scan.id)).not.toBeNull();
	});

	it("refuses deletion while a tool run is still active", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/code",
		});
		const scan = await scanRepository.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "completed",
		});
		await scanRepository.createToolRun({
			scanRunId: scan.id,
			toolName: "still-running",
			status: "running",
		});

		await expect(
			service.deleteOwnedScan({ scanRunId: scan.id, userId }),
		).rejects.toMatchObject({
			status: 409,
			code: "SCAN_HAS_ACTIVE_WORK",
			details: { activeWork: [{ kind: "tool_runs", count: 1 }] },
		});
		expect(cleanupRunner.enqueue).not.toHaveBeenCalled();
		expect(await scanRepository.findById(scan.id)).not.toBeNull();
	});

	it("does not expose another owner's scan", async () => {
		const [otherUser] = await connection.db
			.insert(users)
			.values({
				email: "other-scan-delete@example.com",
				passwordHash: "hash",
				displayName: "Other User",
				role: "member",
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning();
		const project = await projectRepository.createProject({
			ownerUserId: otherUser.id,
			name: "Other",
			repoPath: "/tmp/other",
		});
		const scan = await scanRepository.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "completed",
		});

		await expect(
			service.deleteOwnedScan({ scanRunId: scan.id, userId }),
		).rejects.toMatchObject({ status: 403 });
		expect(cleanupRunner.enqueue).not.toHaveBeenCalled();
	});

	it("rolls back the cleanup job when deleting the scan fails", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/code",
		});
		const scan = await scanRepository.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "completed",
		});
		const dynamicRun = await createDynamicRun(project.id, scan.id);
		connection.sqlite.exec(`
			CREATE TRIGGER prevent_scan_delete
			BEFORE DELETE ON scan_runs
			BEGIN
				SELECT RAISE(ABORT, 'scan delete blocked');
			END;
		`);

		await expect(
			service.deleteOwnedScan({ scanRunId: scan.id, userId }),
		).rejects.toThrow("scan delete blocked");

		expect(await scanRepository.findById(scan.id)).not.toBeNull();
		expect(await connection.db.select().from(dynamicRuns)).toEqual([
			expect.objectContaining({ id: dynamicRun.id, scanRunId: scan.id }),
		]);
		expect(await connection.db.select().from(projectDeletionCleanupJobs)).toHaveLength(
			0,
		);
		expect(cleanupRunner.enqueue).not.toHaveBeenCalled();
	});

	it("returns a conflict when active work starts during deletion", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/code",
		});
		const scan = await scanRepository.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "completed",
		});
		connection.sqlite.exec(`
			CREATE TRIGGER introduce_scan_active_work
			BEFORE INSERT ON project_deletion_cleanup_jobs
			BEGIN
				INSERT INTO scan_reports (id, scan_run_id, format, title, status)
				VALUES ('race-report', '${scan.id}', 'markdown', 'Race report', 'running');
			END;
		`);

		await expect(
			service.deleteOwnedScan({ scanRunId: scan.id, userId }),
		).rejects.toMatchObject({ status: 409, code: "SCAN_HAS_ACTIVE_WORK" });

		expect(await scanRepository.findById(scan.id)).not.toBeNull();
		expect(await connection.db.select().from(scanReports)).toHaveLength(0);
		expect(await connection.db.select().from(projectDeletionCleanupJobs)).toHaveLength(
			0,
		);
		expect(cleanupRunner.enqueue).not.toHaveBeenCalled();
	});
});
