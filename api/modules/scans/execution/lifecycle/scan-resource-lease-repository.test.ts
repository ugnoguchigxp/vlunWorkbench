import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../../../db";
import { projects, scanRuns, users } from "../../../../db/schema";
import { ScanResourceLeaseRepository } from "./scan-resource-lease-repository";
import { ScanResourceLeaseReaper } from "./scan-resource-lease-reaper";

describe("scan resource leases", () => {
	let connection: DbConnection;
	let repository: ScanResourceLeaseRepository;
	let scanRunId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const filename of readdirSync(path.resolve(process.cwd(), "drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort()) {
			connection.sqlite.exec(
				readFileSync(path.resolve(process.cwd(), "drizzle", filename), "utf8"),
			);
		}
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "lease@example.invalid",
				passwordHash: "hash",
				displayName: "Lease Test",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: user!.id,
				name: "Lease Project",
				repoPath: "/tmp/lease-project",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId: project!.id,
				profile: "baseline",
				status: "running",
				profileOutcome: "pending",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = scanRun!.id;
		repository = new ScanResourceLeaseRepository(connection.db);
	});

	afterEach(() => connection.sqlite.close());

	it("tracks expiry, release, and quarantine as durable state transitions", async () => {
		const lease = await repository.acquire({
			scanRunId,
			stepId: "dast:web-passive-standard",
			resourceType: "runtime_target",
			provider: "local",
			externalId: "target-1",
			leaseExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
		});
		expect(lease).toMatchObject({ state: "active", externalId: "target-1" });
		expect(
			await repository.listRecoverable(new Date("2026-01-02T00:00:00.000Z")),
		).toHaveLength(1);
		expect(await repository.quarantine(lease!.id, { reasonCode: "cleanup_failed" })).toMatchObject({ state: "quarantined" });
		expect(await repository.release(lease!.id, { released: true })).toMatchObject({ state: "released", releasedAt: expect.any(Date) });
	});

	it("releases reclaimable resources and quarantines cleanup failures", async () => {
		const expiresAt = new Date("2026-01-01T00:00:00.000Z");
		await repository.acquire({
			scanRunId,
			stepId: "runtime-target",
			resourceType: "runtime_target",
			provider: "local",
			externalId: "good-target",
			leaseExpiresAt: expiresAt,
		});
		const failed = await repository.acquire({
			scanRunId,
			stepId: "runtime-target",
			resourceType: "runtime_target",
			provider: "local",
			externalId: "bad-target",
			leaseExpiresAt: expiresAt,
		});
		const reaper = new ScanResourceLeaseReaper(repository, async (lease) => {
			if (lease.externalId === "bad-target") throw new Error("stop failed");
		});

		expect(await reaper.reap(new Date("2026-01-02T00:00:00.000Z"))).toEqual({
			released: 1,
			quarantined: 1,
		});
		expect(await repository.listRecoverable(new Date("2026-01-03T00:00:00.000Z"))).toEqual([]);
		expect(await repository.release(failed!.id)).toMatchObject({
			state: "released",
		});
	});
});
