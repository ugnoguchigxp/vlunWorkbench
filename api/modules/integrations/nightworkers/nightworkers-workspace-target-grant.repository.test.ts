import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../../db";
import {
	integrationClients,
	integrationIdempotencyKeys,
	integrationResourceBindings,
	projects,
	scanRuns,
	users,
} from "../../../db/schema";
import {
	NightworkersWorkspaceTargetGrantRepository,
	WorkspaceGrantAlreadyConsumedError,
	WorkspaceGrantChangedError,
} from "./nightworkers-workspace-target-grant.repository";

describe("NightworkersWorkspaceTargetGrantRepository", () => {
	let connection: DbConnection;
	let repository: NightworkersWorkspaceTargetGrantRepository;
	let ownerUserId: string;
	let projectId: string;
	let integrationClientId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		const migrationsDirectory = path.resolve(process.cwd(), "drizzle");
		for (const filename of readdirSync(migrationsDirectory)
			.filter((file) => file.endsWith(".sql"))
			.sort((left, right) => left.localeCompare(right))) {
			connection.sqlite.exec(
				readFileSync(path.resolve(migrationsDirectory, filename), "utf8"),
			);
		}
		const now = new Date("2026-08-15T00:00:00.000Z");
		const [owner] = await connection.db
			.insert(users)
			.values({
				email: "workspace-grant-owner@example.com",
				passwordHash: "hash",
				displayName: "Workspace grant owner",
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
				name: "Workspace grant project",
				repoPath: "/workspace/project",
				canonicalRepoPath: "/workspace/project",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;
		const [client] = await connection.db
			.insert(integrationClients)
			.values({
				name: "workspace-grant-client",
				ownerUserId,
				tokenPrefix: "fedcba9876543210",
				tokenHash: "f".repeat(64),
				scopes: ["nightworkers:security-scan:write"],
				allowedRoots: ["/workspace"],
				rateLimitPolicy: { limit: 100, windowMs: 60_000 },
				active: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		integrationClientId = client.id;
		repository = new NightworkersWorkspaceTargetGrantRepository(connection.db);
	});

	afterEach(() => connection.sqlite.close());

	it("consumes once under concurrent retries and creates one bound scan", async () => {
		const grant = await createPreviewedGrant(repository, {
			integrationClientId,
			ownerUserId,
			projectId,
		});
		const params = consumptionParams({
			grantId: grant.id,
			grantRef: grant.grantRef,
			expectedRevision: grant.revision,
			integrationClientId,
			ownerUserId,
			projectId,
		});

		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				repository.consumeAndCreateScan(params),
			),
		);
		expect(new Set(results.map((result) => result.resourceId)).size).toBe(1);
		expect(results.filter((result) => !result.replayed)).toHaveLength(1);
		expect(await connection.db.select().from(scanRuns)).toHaveLength(1);
		expect(
			await connection.db
				.select()
				.from(integrationResourceBindings)
				.where(eq(integrationResourceBindings.resourceType, "scan_run")),
		).toHaveLength(1);
		expect(
			await connection.db.select().from(integrationIdempotencyKeys),
		).toHaveLength(2);
		await repository.clearWorkspacePathForScan({
			grantRef: grant.grantRef,
			scanRunId: results[0]!.resourceId,
		});
		expect(
			(
				await repository.findForClient({
					grantRef: grant.grantRef,
					integrationClientId,
				})
			)?.canonicalWorkspacePath,
		).toBe("");

		await expect(
			repository.consumeAndCreateScan({
				...params,
				idempotencyKey: "different-key",
				requestHash: "different-request",
			}),
		).rejects.toBeInstanceOf(WorkspaceGrantAlreadyConsumedError);
	});

	it("redacts paths as soon as an unconsumed grant expires", async () => {
		const grant = await repository.create({
			grantRef: `siwg:v1:${"8".repeat(64)}`,
			grantDigest: `sha256:${"8".repeat(64)}`,
			integrationClientId,
			ownerUserId,
			projectId,
			workspaceSubjectRef: "workspace-subject:expired",
			canonicalWorkspacePath: "/workspace/expired",
			expectedGitCommonDirDigest: `sha256:${"2".repeat(64)}`,
			expectedHeadSha: "a".repeat(40),
			providerWorkspaceStateDigest: `sha256:${"3".repeat(64)}`,
			expiresAt: new Date("2026-08-15T00:00:00.000Z"),
		});

		await repository.clearExpiredWorkspacePaths(grant.expiresAt);

		expect(
			(
				await repository.findForClient({
					grantRef: grant.grantRef,
					integrationClientId,
				})
			)?.canonicalWorkspacePath,
		).toBe("");
	});

	it("rejects a stale preview revision without creating an orphan scan", async () => {
		const grant = await createPreviewedGrant(repository, {
			integrationClientId,
			ownerUserId,
			projectId,
		});

		await expect(
			repository.consumeAndCreateScan(
				consumptionParams({
					grantId: grant.id,
					grantRef: grant.grantRef,
					expectedRevision: grant.revision - 1,
					integrationClientId,
					ownerUserId,
					projectId,
				}),
			),
		).rejects.toBeInstanceOf(WorkspaceGrantChangedError);
		expect(await connection.db.select().from(scanRuns)).toHaveLength(0);
	});

	it("guards the database against an idempotency row without a consumed grant", async () => {
		expect(() =>
			connection.db.insert(integrationIdempotencyKeys).values({
				integrationClientId,
				operation: "workspace_grant_consume",
				idempotencyKey: `siwg:v1:${"9".repeat(64)}`,
				requestHash: "request-hash",
				resourceType: "scan_run",
				resourceId: "orphan-scan",
				expiresAt: new Date("2030-01-01T00:00:00.000Z"),
			}).run(),
		).toThrow("workspace_grant_consumption_invalid");
	});
});

async function createPreviewedGrant(
	repository: NightworkersWorkspaceTargetGrantRepository,
	identity: {
		integrationClientId: string;
		ownerUserId: string;
		projectId: string;
	},
) {
	const grant = await repository.create({
		grantRef: `siwg:v1:${"1".repeat(64)}`,
		grantDigest: `sha256:${"1".repeat(64)}`,
		...identity,
		workspaceSubjectRef: "workspace-subject:1",
		canonicalWorkspacePath: "/workspace/project",
		expectedGitCommonDirDigest: `sha256:${"2".repeat(64)}`,
		expectedHeadSha: "a".repeat(40),
		providerWorkspaceStateDigest: `sha256:${"3".repeat(64)}`,
		expiresAt: new Date("2030-01-01T00:00:00.000Z"),
	});
	const preview = await repository.savePreview({
		grantId: grant.id,
		expectedRevision: grant.revision,
		previewRef: `siwp:v1:${"4".repeat(64)}`,
		selection: { mode: "preset", presetId: "standard" },
		targetDigest: "5".repeat(64),
		sourceRevision: "a".repeat(40),
		workspaceStateDigest: `sha256:${"3".repeat(64)}`,
		expiresAt: new Date("2030-01-01T00:00:00.000Z"),
	});
	if (!preview) throw new Error("preview fixture was not saved");
	return preview;
}

function consumptionParams(params: {
	grantId: string;
	grantRef: string;
	expectedRevision: number;
	integrationClientId: string;
	ownerUserId: string;
	projectId: string;
}) {
	return {
		...params,
		profileRef: "diff-basic-security",
		requestHash: "request-hash",
		idempotencyKey: "workspace-start-key",
		idempotencyExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
		metadata: { target: { kind: "working_tree" } },
		eventMessage: "Workspace scan queued.",
		maxConcurrentScans: 10,
	};
}
