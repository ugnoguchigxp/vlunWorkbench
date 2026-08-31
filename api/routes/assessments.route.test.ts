import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../db";
import { users } from "../db/schema";
import { HttpError } from "../modules/auth/errors";
import { WebProcessCapacity } from "../modules/processes/web-process-capacity";
import {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import { createAssessmentsRoute } from "./assessments.route";

describe("assessments route", () => {
	let connection: DbConnection;
	let app: Hono;
	let projectRepository: ProjectRepository;
	let ownerUserId: string;
	let otherUserId: string;
	let currentUserId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const filename of readdirSync(path.resolve("drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort()) {
			connection.sqlite.exec(
				readFileSync(path.resolve("drizzle", filename), "utf8"),
			);
		}
		const [owner, other] = await connection.db
			.insert(users)
			.values([
				{
					email: "assessment-owner@example.com",
					passwordHash: "hash",
					displayName: "Assessment owner",
					role: "member",
					isActive: true,
				},
				{
					email: "assessment-other@example.com",
					passwordHash: "hash",
					displayName: "Assessment other",
					role: "member",
					isActive: true,
				},
			])
			.returning();
		ownerUserId = owner.id;
		otherUserId = other.id;
		currentUserId = ownerUserId;
		projectRepository = new ProjectRepository(connection.db);
		app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", {
				userId: currentUserId,
				email: "assessment@example.com",
				role: "member",
			});
			await next();
		});
		app.onError((error, c) =>
			error instanceof HttpError
				? c.json({ message: error.message }, error.status as never)
				: c.json({ message: (error as Error).message }, 500),
		);
		app.route(
			"/api",
			createAssessmentsRoute({
				db: connection.db,
				projectRepository,
				scanRepository: new ScanRepository(connection.db),
			}),
		);
	});

	afterEach(() => connection.sqlite.close());

	it("creates a project-owned engagement and rejects cross-owner access", async () => {
		const project = await projectRepository.createProject({
			ownerUserId,
			name: "Assessment fixture",
			repoPath: "/tmp/assessment-fixture",
		});
		const create = await app.request(
			`/api/projects/${project.id}/assessments`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					projectId: project.id,
					purpose: "internal",
					environment: "local",
					scope: {
						origins: ["http://127.0.0.1:3000"],
						paths: ["/api"],
						methods: ["GET"],
					},
					rulesOfEngagement: null,
					startsAt: "2026-07-30T00:00:00.000Z",
					expiresAt: "2026-07-31T00:00:00.000Z",
				}),
			},
		);
		expect(create.status).toBe(201);
		expect(
			(await app.request(`/api/projects/${project.id}/assessments`)).status,
		).toBe(200);
		const created = (await create.json()) as { engagement: { id: string } };
		expect(
			(
				await app.request(
					`/api/assessments/${created.engagement.id}/status`,
					{
						method: "PATCH",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ status: "active" }),
					},
				)
			).status,
		).toBe(409);

		currentUserId = otherUserId;
		expect(
			(await app.request(`/api/projects/${project.id}/assessments`)).status,
		).toBe(403);
	});

	it("enforces one-way engagement lifecycle transitions", async () => {
		const project = await projectRepository.createProject({
			ownerUserId,
			name: "Lifecycle fixture",
			repoPath: "/tmp/assessment-lifecycle",
		});
		const create = await app.request(
			`/api/projects/${project.id}/assessments`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					projectId: project.id,
					purpose: "internal",
					environment: "ephemeral",
					scope: {
						origins: ["http://127.0.0.1:3000"],
						paths: ["/api"],
						methods: ["POST", "DELETE"],
					},
					rulesOfEngagement: {
						reference: "ticket",
						allowedPaths: ["/api"],
						allowedMethods: ["POST", "DELETE"],
						requestBudget: 10,
						rateLimitPerSec: 1,
						cleanupContract: "Delete fixtures.",
						expiresAt: "2099-01-01T00:00:00.000Z",
						attestation: "Owned disposable target.",
					},
					startsAt: "2020-01-01T00:00:00.000Z",
					expiresAt: "2099-01-01T00:00:00.000Z",
				}),
			},
		);
		const created = (await create.json()) as { engagement: { id: string } };
		const setStatus = (status: string) =>
			app.request(`/api/assessments/${created.engagement.id}/status`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ status }),
			});
		expect((await setStatus("active")).status).toBe(200);
		expect((await setStatus("revoked")).status).toBe(200);
		expect((await setStatus("active")).status).toBe(409);
	});

	it("publishes versioned controls with explicit partial-automation limits", async () => {
		const response = await app.request("/api/assessment-controls");
		expect(response.status).toBe(200);
		const controls = (await response.json()).controls as Array<{
			id: string;
			version: string;
			automationLevel: string;
			limitations: string[];
		}>;
		expect(controls).toContainEqual(
			expect.objectContaining({
				id: "ASVS-v5.0.0-1.2.4",
				version: "5.0.0",
				automationLevel: "partial",
				limitations: expect.arrayContaining([expect.any(String)]),
			}),
		);
	});

	it("returns 429 before starting ZAP when Web process capacity is occupied", async () => {
		const project = await projectRepository.createProject({
			ownerUserId,
			name: "Capacity fixture",
			repoPath: "/tmp/assessment-capacity",
		});
		const capacity = new WebProcessCapacity(() => ({
			concurrency: 1,
			queueLimit: 1,
		}));
		const occupied = capacity.tryAcquire();
		const activeAssessmentRunner = { run: vi.fn() };
		const capacityApp = new Hono();
		capacityApp.use("*", async (c, next) => {
			c.set("authUser", {
				userId: ownerUserId,
				email: "assessment@example.com",
				role: "member",
			});
			await next();
		});
		capacityApp.onError((error, c) =>
			error instanceof HttpError
				? c.json({ message: error.message }, error.status as never)
				: c.json({ message: (error as Error).message }, 500),
		);
		capacityApp.route(
			"/api",
			createAssessmentsRoute({
				db: connection.db,
				projectRepository,
				scanRepository: new ScanRepository(connection.db),
				activeAssessmentRunner: activeAssessmentRunner as never,
				processCapacity: capacity,
			}),
		);
		const missingConsent = await capacityApp.request(
			`/api/projects/${project.id}/active-assessment-runs`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ kind: "zap_active" }),
			},
		);
		expect(missingConsent.status).toBe(400);
		expect((await missingConsent.json()).message).toContain("Explicit consent");

		const response = await capacityApp.request(
			`/api/projects/${project.id}/active-assessment-runs`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					destructiveConsent: true,
					engagementId: "11111111-1111-4111-8111-111111111111",
					targetConfigId: "22222222-2222-4222-8222-222222222222",
					kind: "zap_active",
					profileId: "runtime-zap-active-lab",
					allowedMethods: ["GET"],
					allowedPaths: ["/"],
					requestBudget: 1,
					durationSec: 60,
					ruleIds: [10_021],
					resetStrategy: {
						kind: "container_recreate",
						fixtureId: "fixture-1",
						expectedBaselineHash: `sha256:${"a".repeat(64)}`,
					},
				}),
			},
		);

		expect(response.status).toBe(429);
		expect(activeAssessmentRunner.run).not.toHaveBeenCalled();
		occupied?.();
	});
});
