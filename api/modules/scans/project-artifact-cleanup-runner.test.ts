import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projectDeletionCleanupJobs, users } from "../../db/schema";
import { ProjectArtifactCleanupRunner } from "./project-artifact-cleanup-runner";
import { ProjectDeletionCleanupRepository } from "./project-deletion-cleanup-repository";

describe("ProjectArtifactCleanupRunner", () => {
	let connection: DbConnection;
	let repository: ProjectDeletionCleanupRepository;
	let ownerUserId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const filename of readdirSync(path.resolve(process.cwd(), "drizzle"))
			.filter((file) => file.endsWith(".sql"))
			.sort((left, right) => left.localeCompare(right))) {
			connection.sqlite.exec(
				readFileSync(path.resolve(process.cwd(), "drizzle", filename), "utf8"),
			);
		}
		repository = new ProjectDeletionCleanupRepository(connection.db);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "cleanup-runner@example.com",
				passwordHash: "hash",
				displayName: "Cleanup Runner",
				role: "member",
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning();
		if (!user) throw new Error("test user was not created");
		ownerUserId = user.id;
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("removes every server-owned artifact directory and completes the job", async () => {
		const job = await repository.create({
			ownerUserId,
			projectId: "deleted-project",
			projectName: "Deleted project",
			manifest: {
				scanRunIds: ["scan-1"],
				dastRunIds: ["dast-1"],
				dynamicRunIds: ["dynamic-1"],
				reproductionRunIds: ["repro-1"],
			},
		});
		const storage = {
			scanStorage: { removeRunDirectory: vi.fn(async () => {}) },
			dastStorage: { removeRunDirectory: vi.fn(async () => {}) },
			dynamicStorage: { removeRunDirectory: vi.fn(async () => {}) },
			reproductionStorage: { removeRunDirectory: vi.fn(async () => {}) },
		};
		const runner = new ProjectArtifactCleanupRunner(repository, storage);

		await runner.run(job.id);

		expect(storage.scanStorage.removeRunDirectory).toHaveBeenCalledWith("scan-1");
		expect(storage.dastStorage.removeRunDirectory).toHaveBeenCalledWith("dast-1");
		expect(storage.dynamicStorage.removeRunDirectory).toHaveBeenCalledWith("dynamic-1");
		expect(storage.reproductionStorage.removeRunDirectory).toHaveBeenCalledWith("repro-1");
		expect((await repository.findById(job.id))?.status).toBe("completed");
	});

	it("keeps a failed job retryable", async () => {
		const job = await repository.create({
			ownerUserId,
			projectId: "deleted-project",
			projectName: "Deleted project",
			manifest: {
				scanRunIds: ["scan-1"],
				dastRunIds: [],
				dynamicRunIds: [],
				reproductionRunIds: [],
			},
		});
		const runner = new ProjectArtifactCleanupRunner(repository, {
			scanStorage: {
				removeRunDirectory: vi.fn(async () => {
					throw new Error("storage unavailable");
				}),
			},
			dastStorage: { removeRunDirectory: vi.fn(async () => {}) },
			dynamicStorage: { removeRunDirectory: vi.fn(async () => {}) },
			reproductionStorage: { removeRunDirectory: vi.fn(async () => {}) },
		});

		await runner.run(job.id);

		const failed = await repository.findById(job.id);
		expect(failed).toMatchObject({ status: "failed", lastError: "storage unavailable" });
		expect((await repository.listRecoverable()).map((item) => item.id)).toContain(job.id);
	});

	it("recovers a cleanup job that was running when the process stopped", async () => {
		const job = await repository.create({
			ownerUserId,
			projectId: "deleted-project",
			projectName: "Deleted project",
			manifest: {
				scanRunIds: [],
				dastRunIds: [],
				dynamicRunIds: [],
				reproductionRunIds: [],
			},
		});
		await repository.claim(job.id);
		await connection.db
			.update(projectDeletionCleanupJobs)
			.set({ updatedAt: new Date(Date.now() - 5 * 60_000 - 1) })
			.where(eq(projectDeletionCleanupJobs.id, job.id));

		expect((await repository.listRecoverable()).map((item) => item.id)).toContain(
			job.id,
		);
		expect((await repository.claim(job.id))?.id).toBe(job.id);
	});
});
