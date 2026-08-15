import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../../db";
import {
	integrationAuditLogs,
	integrationClients,
	integrationIdempotencyKeys,
	integrationResourceBindings,
	projects,
	scanEvents,
	scanReports,
	scanRuns,
	users,
} from "../../../db/schema";
import { ScanRepository } from "../../scans/repositories";
import {
	IntegrationIdempotencyConflictError,
	IntegrationScanCapacityError,
	NightworkersIntegrationRepository,
} from "./nightworkers-integration.repository";

describe("NightworkersIntegrationRepository", () => {
	let connection: DbConnection;
	let repository: NightworkersIntegrationRepository;
	let scanRepository: ScanRepository;
	let ownerUserId: string;
	let projectId: string;
	let integrationClientId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		const migrationsDirectory = path.resolve(process.cwd(), "drizzle");
		for (const filename of readdirSync(migrationsDirectory)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b))) {
			connection.sqlite.exec(
				readFileSync(path.resolve(migrationsDirectory, filename), "utf8"),
			);
		}

		const now = new Date("2026-07-30T00:00:00.000Z");
		const [owner] = await connection.db
			.insert(users)
			.values({
				email: "nightworkers-owner@example.com",
				passwordHash: "hash",
				displayName: "NightWorkers owner",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		ownerUserId = owner.id;
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId,
				name: "Provider fixture",
				repoPath: "/workspace/provider-fixture",
				canonicalRepoPath: "/workspace/provider-fixture",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;
		const [client] = await connection.db
			.insert(integrationClients)
			.values({
				name: "nightworkers-test",
				ownerUserId,
				tokenPrefix: "0123456789abcdef",
				tokenHash: "a".repeat(64),
				scopes: [
					"nightworkers:security-scan:read",
					"nightworkers:security-scan:write",
				],
				allowedRoots: ["/workspace"],
				rateLimitPolicy: { limit: 100, windowMs: 60_000 },
				active: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		integrationClientId = client.id;
		repository = new NightworkersIntegrationRepository(connection.db);
		scanRepository = new ScanRepository(connection.db);
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("creates exactly one scan for concurrent retries and rejects key reuse with a different request", async () => {
		const idempotencyKey = "11111111-1111-4111-8111-111111111111";
		const common = {
			integrationClientId,
			ownerUserId,
			projectId,
			profileRef: "diff-basic-security",
			requestHash: "request-hash-a",
			idempotencyKey,
			idempotencyExpiresAt: new Date("2026-08-06T00:00:00.000Z"),
			metadata: { integrationPresetId: "standard" },
			eventMessage: "Scan queued.",
			maxConcurrentScans: 100,
		};

		const results = await Promise.all(
			Array.from({ length: 12 }, () =>
				repository.createIdempotentScan(common),
			),
		);
		const scanRunIds = new Set(results.map((result) => result.resourceId));
		expect(scanRunIds.size).toBe(1);
		expect(results.filter((result) => !result.replayed)).toHaveLength(1);
		expect(await connection.db.select().from(scanRuns)).toHaveLength(1);
		expect(
			await connection.db
				.select()
				.from(integrationResourceBindings)
				.where(eq(integrationResourceBindings.resourceType, "scan_run")),
		).toHaveLength(1);
		expect(
			await connection.db
				.select()
				.from(integrationIdempotencyKeys)
				.where(eq(integrationIdempotencyKeys.operation, "scan_start")),
		).toHaveLength(1);

		await expect(
			repository.createIdempotentScan({
				...common,
				requestHash: "request-hash-b",
			}),
		).rejects.toBeInstanceOf(IntegrationIdempotencyConflictError);
	});

	it("namespaces idempotency keys per operation", async () => {
		const idempotencyKey = "22222222-2222-4222-8222-222222222222";
		const expiresAt = new Date("2026-08-06T00:00:00.000Z");
		const scan = await repository.createIdempotentScan({
			integrationClientId,
			ownerUserId,
			projectId,
			profileRef: "source-baseline",
			requestHash: "scan-request",
			idempotencyKey,
			idempotencyExpiresAt: expiresAt,
			metadata: {},
			eventMessage: "Scan queued.",
			maxConcurrentScans: 100,
		});
		const report = await repository.createIdempotentReport({
			integrationClientId,
			ownerUserId,
			projectId,
			scanRunId: scan.resourceId,
			requestHash: "report-request",
			idempotencyKey,
			idempotencyExpiresAt: expiresAt,
			title: "Security report",
			options: { summaryMode: "deterministic_with_llm_summary" },
		});

		expect(report.resourceId).not.toBe(scan.resourceId);
		expect(await connection.db.select().from(scanReports)).toHaveLength(1);
		expect(await connection.db.select().from(integrationIdempotencyKeys)).toHaveLength(
			2,
		);
	});

	it("retains expired keys for active resources and cleans them after terminal state", async () => {
		const common = {
			integrationClientId,
			ownerUserId,
			projectId,
			profileRef: "source-baseline",
			idempotencyKey: "44444444-4444-4444-8444-444444444444",
			metadata: {},
			eventMessage: "Scan queued.",
			maxConcurrentScans: 100,
		};
		const expired = await repository.createIdempotentScan({
			...common,
			requestHash: "expired-request",
			idempotencyExpiresAt: new Date(0),
		});
		await expect(
			repository.createIdempotentScan({
				...common,
				requestHash: "replacement-request",
				idempotencyExpiresAt: new Date(Date.now() + 60_000),
			}),
		).rejects.toBeInstanceOf(IntegrationIdempotencyConflictError);
		await repository.cleanupExpired();
		expect(
			await connection.db.select().from(integrationIdempotencyKeys),
		).toHaveLength(1);

		await scanRepository.updateScanRunStatus(expired.resourceId, "completed");
		await repository.cleanupExpired();
		const replacement = await repository.createIdempotentScan({
			...common,
			requestHash: "replacement-request",
			idempotencyExpiresAt: new Date(Date.now() + 60_000),
		});

		expect(replacement).toMatchObject({ replayed: false });
		expect(replacement.resourceId).not.toBe(expired.resourceId);
		expect(await connection.db.select().from(scanRuns)).toHaveLength(2);
		expect(
			await connection.db.select().from(integrationIdempotencyKeys),
		).toHaveLength(1);
	});

	it("assigns contiguous event sequences under concurrent writes and preserves terminal scan state", async () => {
		const scan = await repository.createIdempotentScan({
			integrationClientId,
			ownerUserId,
			projectId,
			profileRef: "source-baseline",
			requestHash: "sequence-request",
			idempotencyKey: "33333333-3333-4333-8333-333333333333",
			idempotencyExpiresAt: new Date("2026-08-06T00:00:00.000Z"),
			metadata: {},
			eventMessage: "Scan queued.",
			maxConcurrentScans: 100,
		});

		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				scanRepository.createScanEvent({
					scanRunId: scan.resourceId,
					level: "info",
					eventType: "tool.progress",
					message: `Progress ${index}`,
				}),
			),
		);

		const events = await connection.db.query.scanEvents.findMany({
			where: eq(scanEvents.scanRunId, scan.resourceId),
			orderBy: (fields, { asc }) => [asc(fields.seq)],
		});
		expect(events.map((event) => event.seq)).toEqual(
			Array.from({ length: 21 }, (_, index) => index + 1),
		);
		expect((await scanRepository.findById(scan.resourceId))?.lastEventSeq).toBe(
			21,
		);

		await scanRepository.updateScanRunStatus(scan.resourceId, "completed");
		await Promise.all([
			scanRepository.updateScanRunStatus(scan.resourceId, "cancelled"),
			scanRepository.updateScanRunStatus(scan.resourceId, "failed"),
			scanRepository.updateScanRunStatus(scan.resourceId, "running"),
		]);
		const terminal = await scanRepository.findById(scan.resourceId);
		expect(terminal?.status).toBe("completed");
		expect(terminal?.completedAt).toBeInstanceOf(Date);
	});

	it("enforces the active scan limit across concurrent distinct requests", async () => {
		const attempts = await Promise.allSettled(
			Array.from({ length: 8 }, (_, index) =>
				repository.createIdempotentScan({
					integrationClientId,
					ownerUserId,
					projectId,
					profileRef: "source-baseline",
					requestHash: `capacity-request-${index}`,
					idempotencyKey: `capacity-key-${index}`,
					idempotencyExpiresAt: new Date("2026-08-06T00:00:00.000Z"),
					metadata: {},
					eventMessage: "Scan queued.",
					maxConcurrentScans: 2,
				}),
			),
		);
		const accepted = attempts.filter(
			(result) => result.status === "fulfilled",
		);
		const rejected = attempts.filter(
			(result) => result.status === "rejected",
		);

		expect(accepted).toHaveLength(2);
		expect(rejected).toHaveLength(6);
		for (const result of rejected) {
			if (result.status === "rejected") {
				expect(result.reason).toBeInstanceOf(IntegrationScanCapacityError);
			}
		}
		expect(await connection.db.select().from(scanRuns)).toHaveLength(2);
	});

	it("enforces scan capacity in SQLite when process-local locks are bypassed", async () => {
		await repository.createIdempotentScan({
			integrationClientId,
			ownerUserId,
			projectId,
			profileRef: "source-baseline",
			requestHash: "database-capacity-first",
			idempotencyKey: "database-capacity-first",
			idempotencyExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
			metadata: {},
			eventMessage: "Scan queued.",
			maxConcurrentScans: 1,
		});
		const secondScanRunId = "55555555-5555-4555-8555-555555555555";
		await connection.db.insert(scanRuns).values({
			id: secondScanRunId,
			projectId,
			profile: "source-baseline",
			status: "queued",
			createdByUserId: ownerUserId,
		});

		expect(() =>
			connection.db
				.insert(integrationResourceBindings)
				.values({
					integrationClientId,
					resourceType: "scan_run",
					resourceId: secondScanRunId,
					projectId,
					ownerUserId,
					activeCapacityLimit: 1,
				})
				.run(),
		).toThrow("integration_scan_capacity_exceeded");

		expect(() =>
			connection.db
				.insert(integrationResourceBindings)
				.values({
					integrationClientId,
					resourceType: "scan_run",
					resourceId: secondScanRunId,
					projectId,
					ownerUserId,
				})
				.run(),
		).toThrow("integration_scan_capacity_exceeded");
	});

	it("persists anonymous authentication rejection audits without credentials", async () => {
		await repository.recordAudit({
			integrationClientId: null,
			ownerUserId: null,
			scope: "nightworkers:integration",
			operation: "integration_authentication",
			requestId: "anonymous-request",
			outcome: "rejected",
			errorCode: "integration_unauthorized",
		});

		const [audit] = await connection.db.select().from(integrationAuditLogs);
		expect(audit).toMatchObject({
			integrationClientId: null,
			ownerUserId: null,
			operation: "integration_authentication",
			requestId: "anonymous-request",
			outcome: "rejected",
			errorCode: "integration_unauthorized",
		});
		expect(JSON.stringify(audit)).not.toContain("Bearer");
	});
});
