import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users } from "../../db/schema";
import type { ValidatedDastTarget } from "../dast/types";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import { ZapActiveAssessmentCoordinator } from "./zap-active-assessment-coordinator";

function migrate(connection: DbConnection): void {
	for (const filename of readdirSync(path.resolve("drizzle"))
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		connection.sqlite.exec(
			readFileSync(path.resolve("drizzle", filename), "utf8"),
		);
	}
}

const target: ValidatedDastTarget = {
	ok: true,
	targetConfigId: "00000000-0000-4000-8000-000000000001",
	normalizedOrigin: "http://127.0.0.1:3000",
	runnerOrigin: "http://127.0.0.1:3000",
	allowedPaths: ["/api"],
	excludedPaths: [],
	defaultHeaders: {},
	maxDepth: 1,
	maxRequests: 500,
	rateLimitPerSec: 2,
	timeoutSec: 600,
	resolvedAddresses: ["127.0.0.1"],
	warnings: [],
};

type CoordinatorInput = Parameters<ZapActiveAssessmentCoordinator["run"]>[0];

const engagement: CoordinatorInput["engagement"] = {
	engagementId: "00000000-0000-4000-8000-000000000010",
	projectId: "00000000-0000-4000-8000-000000000020",
	status: "active" as const,
	purpose: "internal",
	environment: "ephemeral",
	startsAt: "2026-07-29T00:00:00.000Z",
	expiresAt: "2027-07-31T00:00:00.000Z",
	scope: {
		origins: ["http://127.0.0.1:3000"],
		paths: ["/api"],
		methods: ["GET", "POST"],
	},
	rulesOfEngagement: {
		reference: "fixture",
		allowedPaths: ["/api"],
		allowedMethods: ["GET", "POST"],
		requestBudget: 500,
		rateLimitPerSec: 2,
		cleanupContract: "fixture reset",
		expiresAt: "2027-07-31T00:00:00.000Z",
		attestation: "internal fixture authorization",
	},
};

const request: CoordinatorInput["request"] = {
	kind: "zap_active" as const,
	engagementId: "00000000-0000-4000-8000-000000000010",
	targetConfigId: "00000000-0000-4000-8000-000000000001",
	profileId: "runtime-zap-active-lab" as const,
	allowedMethods: ["GET", "POST"],
	allowedPaths: ["/api/orders"],
	requestBudget: 200,
	durationSec: 60,
	ruleIds: [40012],
	resetStrategy: {
		kind: "container_recreate" as const,
		fixtureId: "juice-shop",
		expectedBaselineHash: `sha256:${"a".repeat(64)}`,
	},
};

describe("ZapActiveAssessmentCoordinator", () => {
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let scanRunId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		migrate(connection);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "zap@example.com",
				passwordHash: "hash",
				displayName: "Zap",
				role: "member",
				isActive: true,
			})
			.returning();
		userId = user.id;
		const project = await new ProjectRepository(connection.db).createProject({
			ownerUserId: userId,
			name: "Zap",
			repoPath: "/tmp/zap",
		});
		projectId = project.id;
		const scan = await new ScanRepository(connection.db).createScanRun({
			projectId,
			profile: "runtime-zap-active-lab",
			status: "running",
			createdByUserId: userId,
		});
		scanRunId = scan.id;
	});

	afterEach(() => {
		connection.sqlite.close(false);
	});

	it("rejects a disabled feature before mutating scan state", async () => {
		const coordinator = new ZapActiveAssessmentCoordinator(connection.db, {
			featureEnabled: false,
		});
		await expect(
			coordinator.run({
				projectId,
				createdByUserId: userId,
				scanRunId,
				activeAssessmentRunId: "00000000-0000-4000-8000-000000000099",
				request,
				engagement,
				target,
				initialRequestCount: 0,
				plannedRequestCount: 200,
			}),
		).rejects.toThrow("zap_active_feature_disabled");
	});

	it("requires an auth repository when an auth context is supplied", async () => {
		const coordinator = new ZapActiveAssessmentCoordinator(connection.db, {
			featureEnabled: true,
		});
		await expect(
			coordinator.run({
				projectId,
				createdByUserId: userId,
				scanRunId,
				activeAssessmentRunId: "00000000-0000-4000-8000-000000000099",
				request: {
					...request,
					authContextId: "00000000-0000-4000-8000-000000000077",
					identityRole: "user",
				},
				engagement,
				target,
				initialRequestCount: 0,
				plannedRequestCount: 200,
			}),
		).rejects.toThrow("dast_auth_context_repository_unavailable");
	});
});
