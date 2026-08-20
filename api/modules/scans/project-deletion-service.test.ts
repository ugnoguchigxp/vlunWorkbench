import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { staticIntelligencePrepareJobs, users } from "../../db/schema";
import { HttpError } from "../auth/errors";
import { ProjectArtifactCleanupRunner } from "./project-artifact-cleanup-runner";
import { ProjectDeletionCleanupRepository } from "./project-deletion-cleanup-repository";
import { ProjectDeletionService } from "./project-deletion-service";
import { ProjectRepository, ScanRepository } from "./repositories";

describe("ProjectDeletionService", () => {
	let connection: DbConnection;
	let userId: string;
	let projectRepository: ProjectRepository;
	let scanRepository: ScanRepository;
	let cleanupRepository: ProjectDeletionCleanupRepository;
	let cleanupRunner: ProjectArtifactCleanupRunner;
	let service: ProjectDeletionService;

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
				email: "delete-test@example.com",
				passwordHash: "hash",
				displayName: "Delete Test",
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
		cleanupRunner = new ProjectArtifactCleanupRunner(cleanupRepository, {
			scanStorage: { removeRunDirectory: vi.fn(async () => {}) },
			dastStorage: { removeRunDirectory: vi.fn(async () => {}) },
			dynamicStorage: { removeRunDirectory: vi.fn(async () => {}) },
			reproductionStorage: { removeRunDirectory: vi.fn(async () => {}) },
		});
		vi.spyOn(cleanupRunner, "enqueue").mockImplementation(() => {});
		service = new ProjectDeletionService({
			db: connection.db,
			projectRepository,
			cleanupRunner,
		});
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("deletes the owned project, persists a cleanup manifest, and never uses repoPath", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/keep-this-repository",
		});
		const scan = await scanRepository.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "completed",
		});

		const result = await service.deleteOwnedProject({
			projectId: project.id,
			userId,
			confirmation: "Code",
		});

		expect(result).toMatchObject({
			deletedProjectId: project.id,
			artifactCleanup: "queued",
		});
		expect(await projectRepository.findById(project.id)).toBeNull();
		const [job] = await cleanupRepository.listRecoverable();
		expect(job?.manifest).toEqual({
			scanRunIds: [scan.id],
			dastRunIds: [],
			dynamicRunIds: [],
			reproductionRunIds: [],
		});
		expect(JSON.stringify(job?.manifest)).not.toContain("keep-this-repository");
		expect(cleanupRunner.enqueue).toHaveBeenCalledWith(job?.id);
	});

	it("rejects a mismatched confirmation with a stable code", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/code",
		});

		await expect(
			service.deleteOwnedProject({
				projectId: project.id,
				userId,
				confirmation: "code",
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "PROJECT_CONFIRMATION_MISMATCH",
		});
	});

	it("refuses deletion while a scan is queued or running", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/code",
		});
		await scanRepository.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "queued",
		});

		await expect(
			service.deleteOwnedProject({
				projectId: project.id,
				userId,
				confirmation: "Code",
			}),
		).rejects.toMatchObject({
			status: 409,
			code: "PROJECT_HAS_ACTIVE_WORK",
			details: { activeWork: [{ kind: "scan_runs", count: 1 }] },
		});
	});

	it("refuses deletion while static intelligence is still requested", async () => {
		const project = await projectRepository.createProject({
			ownerUserId: userId,
			name: "Code",
			repoPath: "/tmp/code",
		});
		await connection.db.insert(staticIntelligencePrepareJobs).values({
			projectId: project.id,
			canonicalProjectPath: "/tmp/code",
			sourceFingerprint: "fingerprint",
			status: "requested",
			stage: "checking_freshness",
			attemptCount: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await expect(
			service.deleteOwnedProject({
				projectId: project.id,
				userId,
				confirmation: "Code",
			}),
		).rejects.toMatchObject({
			status: 409,
			code: "PROJECT_HAS_ACTIVE_WORK",
			details: {
				activeWork: [
					{ kind: "static_intelligence_prepare_jobs", count: 1 },
				],
			},
		});
	});
});
