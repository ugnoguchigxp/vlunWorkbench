import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
	AuthorizationMatrix,
	RunActiveAssessmentRequest,
} from "../../../shared/schemas/active-assessment.schema";
import { createDbConnection, type DbConnection } from "../../db";
import {
	activeAssessmentEvidences,
	activeAssessmentRuns,
	findings,
	users,
} from "../../db/schema";
import { AssessmentRepository } from "../assessments/assessment-repository";
import { ensureScanCoverageResults } from "../assessments/coverage-builder";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import { ActiveAssessmentRepository } from "./active-assessment-repository";
import {
	ActiveAssessmentRunner,
	activeProfileOutcome,
	activeScanStatus,
} from "./active-assessment-runner";
import { DastAuthContextCrypto } from "./auth-context-crypto";
import { DastAuthContextRepository } from "./auth-context-repository";
import { DastRepository } from "./dast-repository";

describe("ActiveAssessmentRunner", () => {
	it("maps execution and cleanup failures to a failed scan", () => {
		expect(activeScanStatus("failed")).toBe("failed");
		expect(activeScanStatus("failed_cleanup")).toBe("failed");
		expect(activeScanStatus("inconclusive")).toBe("completed");
		expect(activeScanStatus("completed")).toBe("completed");
		expect(activeProfileOutcome("failed_cleanup")).toBe("failed");
		expect(activeProfileOutcome("inconclusive")).toBe("incomplete");
		expect(activeProfileOutcome("completed")).toBe("completed");
	});

	let connection: DbConnection;
	let server: ReturnType<typeof Bun.serve>;
	let projectId: string;
	let targetConfigId: string;
	let userId: string;
	let authRepository: DastAuthContextRepository;
	let vulnerable = true;
	let matrixStatusOverride: number | null = null;
	let transactionObjectExists = false;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const filename of readdirSync(path.resolve("drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort()) {
			connection.sqlite.exec(
				readFileSync(path.resolve("drizzle", filename), "utf8"),
			);
		}
		const roleBySecret = new Map([
			["fixture-secret-user-a", "user-a"],
			["fixture-secret-user-b", "user-b"],
			["fixture-secret-admin", "admin"],
		]);
		server = Bun.serve({
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname.startsWith("/objects/")) {
					if (matrixStatusOverride !== null) {
						return new Response(null, {
							status: matrixStatusOverride,
						});
					}
					const objectId = url.pathname.split("/").at(-1);
					const role = roleBySecret.get(
						request.headers.get("x-fixture-auth") ?? "",
					);
					const ownerRole = objectId === "object-a" ? "user-a" : "user-b";
					const allowed =
						role === "admin" ||
						role === ownerRole ||
						(vulnerable && role === "user-a" && objectId === "object-b");
					return new Response(allowed ? "allowed" : "denied", {
						status: allowed ? 200 : 403,
					});
				}
				if (url.pathname === "/fixtures" && request.method === "POST") {
					transactionObjectExists = true;
					return new Response(null, { status: 201 });
				}
				if (
					url.pathname === "/fixtures/a" &&
					request.method === "PATCH"
				) {
					return new Response(null, { status: 500 });
				}
				if (
					url.pathname === "/fixtures/a" &&
					request.method === "DELETE"
				) {
					transactionObjectExists = false;
					return new Response(null, { status: 204 });
				}
				return new Response(null, { status: 404 });
			},
		});
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "active-runner@example.com",
				passwordHash: "hash",
				displayName: "Active runner",
				role: "member",
				isActive: true,
			})
			.returning();
		userId = user.id;
		const project = await new ProjectRepository(connection.db).createProject({
			ownerUserId: userId,
			name: "Active fixture",
			repoPath: "/tmp/active-fixture",
		});
		projectId = project.id;
		const target = await new DastRepository(
			connection.db,
		).createTargetConfig({
			projectId,
			name: "Active target",
			origin: `http://127.0.0.1:${server.port}`,
			allowedPathsJson: ["/objects", "/fixtures"],
			maxRequests: 100,
			rateLimitPerSec: 100,
			timeoutSec: 5,
		});
		targetConfigId = target.id;
		authRepository = new DastAuthContextRepository(
			connection.db,
			new DastAuthContextCrypto(Buffer.alloc(32, 8).toString("base64")),
		);
	});

	afterEach(() => {
		server.stop(true);
		connection.sqlite.close();
	});

	it("distinguishes vulnerable and fixed real HTTP authorization matrices", async () => {
		const authContextIds = new Map<string, string>();
		for (const role of ["user-a", "user-b", "admin"]) {
			const context = await authRepository.create({
				projectId,
				targetConfigId,
				identityRole: role,
				label: role,
				secret: {
					kind: "named_header",
					name: "X-Fixture-Auth",
					value: `fixture-secret-${role}`,
				},
				loginFlow: [],
				expiresAt: "2099-01-01T00:00:00.000Z",
				createdByUserId: userId,
			});
			authContextIds.set(role, context.id);
		}
		const engagementId = await createActiveEngagement({
			connection,
			projectId,
			userId,
			methods: ["GET"],
			paths: ["/objects"],
			origin: `http://127.0.0.1:${server.port}`,
		});
		const matrix: AuthorizationMatrix = {
			actors: ["user-a", "user-b", "admin"].map((identityRole) => ({
				identityRole,
				authContextId: authContextIds.get(identityRole) as string,
			})),
			objects: [
				{ id: "object-a", ownerRole: "user-a", path: "/objects/object-a" },
				{ id: "object-b", ownerRole: "user-b", path: "/objects/object-b" },
			],
			operations: [
				{
					id: "read-object",
					method: "GET",
					pathTemplate: "/objects/{objectId}",
					allowedRoles: ["admin"],
					ownerAllowed: true,
				},
			],
		};
		const runner = new ActiveAssessmentRunner(connection.db, {
			authContextRepository: authRepository,
		});
		const vulnerableResult = await runner.run({
			projectId,
			createdByUserId: userId,
			executionConsent: true,
			request: {
				kind: "authorization_matrix",
				engagementId,
				targetConfigId,
				matrix,
				maxRequests: 20,
			},
		});
		expect(vulnerableResult).toMatchObject({
			status: "completed",
			requestCount: 6,
			findingCount: 1,
		});
		const vulnerableCoverage = await ensureScanCoverageResults(
			connection.db,
			vulnerableResult.scanRunId,
		);
		expect(
			vulnerableCoverage.find((row) => row.controlId === "API1:2023"),
		).toMatchObject({
			status: "tested_failed",
			evidenceRefs: [
				{
					kind: "active_assessment",
					id: vulnerableResult.activeAssessmentRunId,
				},
			],
		});

		vulnerable = false;
		const fixedResult = await runner.run({
			projectId,
			createdByUserId: userId,
			executionConsent: true,
			request: {
				kind: "authorization_matrix",
				engagementId,
				targetConfigId,
				matrix,
				maxRequests: 20,
			},
		});
		expect(fixedResult).toMatchObject({
			status: "completed",
			requestCount: 6,
			findingCount: 0,
		});
		const fixedCoverage = await ensureScanCoverageResults(
			connection.db,
			fixedResult.scanRunId,
		);
		expect(
			fixedCoverage.find((row) => row.controlId === "API1:2023"),
		).toMatchObject({
			status: "inconclusive",
			reasonCode: "partial_automation_without_finding",
		});
		expect(await connection.db.select().from(findings)).toMatchObject([
			{ confidence: "runtime" },
		]);
		expect(
			await connection.db.select().from(activeAssessmentEvidences),
		).toHaveLength(12);
		const persisted = JSON.stringify({
			runs: await connection.db.select().from(activeAssessmentRuns),
			evidence: await connection.db.select().from(activeAssessmentEvidences),
		});
		expect(persisted).not.toContain("fixture-secret-");

		matrixStatusOverride = 302;
		const inconclusiveResult = await runner.run({
			projectId,
			createdByUserId: userId,
			executionConsent: true,
			request: {
				kind: "authorization_matrix",
				engagementId,
				targetConfigId,
				matrix,
				maxRequests: 20,
			},
		});
		expect(inconclusiveResult).toMatchObject({
			status: "inconclusive",
			requestCount: 6,
			findingCount: 0,
			errorMessage: "authorization_response_inconclusive",
		});
	});

	it("persists an inconclusive transaction only after cleanup succeeds", async () => {
		const engagementId = await createActiveEngagement({
			connection,
			projectId,
			userId,
			methods: ["POST", "PATCH", "DELETE"],
			paths: ["/fixtures"],
			origin: `http://127.0.0.1:${server.port}`,
			requestBudget: 3,
		});
		const request = {
			kind: "transaction",
			engagementId,
			targetConfigId,
			transaction: {
				id: "cleanup-fixture",
				seed: [
					{
						method: "POST",
						path: "/fixtures",
						headers: {},
						body: null,
						expectedStatus: [201],
					},
				],
				request: {
					method: "PATCH",
					path: "/fixtures/a",
					headers: {},
					body: null,
					expectedStatus: [200],
				},
				cleanup: [
					{
						method: "DELETE",
						path: "/fixtures/a",
						headers: {},
						body: null,
						expectedStatus: [204],
					},
				],
				maxRequests: 3,
			},
		} satisfies RunActiveAssessmentRequest;
		const runner = new ActiveAssessmentRunner(connection.db);
		const result = await runner.run({
			projectId,
			createdByUserId: userId,
			executionConsent: true,
			request,
		});
		expect(result.status).toBe("inconclusive");
		expect(result.requestCount).toBe(3);
		expect(transactionObjectExists).toBe(false);
		await expect(
			runner.run({
				projectId,
				createdByUserId: userId,
				executionConsent: true,
				request,
			}),
		).rejects.toThrow("roe_request_budget_insufficient_for_plan");
	});

	it("rejects active assessments outside a disposable internal environment", async () => {
		const engagementId = await createActiveEngagement({
			connection,
			projectId,
			userId,
			methods: ["POST", "PATCH", "DELETE"],
			paths: ["/fixtures"],
			origin: `http://127.0.0.1:${server.port}`,
			environment: "staging",
		});
		const runner = new ActiveAssessmentRunner(connection.db);

		await expect(
			runner.run({
				projectId,
				createdByUserId: userId,
				executionConsent: true,
				request: {
					kind: "transaction",
					engagementId,
					targetConfigId,
					transaction: {
						id: "unsafe-environment",
						seed: [],
						request: {
							method: "PATCH",
							path: "/fixtures/a",
							headers: {},
							body: null,
							expectedStatus: [200],
						},
						cleanup: [],
						maxRequests: 1,
					},
				},
			}),
		).rejects.toThrow("active_assessment_disposable_internal_target_required");
		expect(
			await new ScanRepository(connection.db).listScanRuns(projectId),
		).toHaveLength(0);
	});

	it("serializes active work per project", async () => {
		const engagementId = await createActiveEngagement({
			connection,
			projectId,
			userId,
			methods: ["POST", "PATCH", "DELETE"],
			paths: ["/fixtures"],
			origin: `http://127.0.0.1:${server.port}`,
		});
		let releaseFirstRequest: () => void = () => undefined;
		const firstRequestGate = new Promise<void>((resolve) => {
			releaseFirstRequest = resolve;
		});
		let signalRequestStarted: () => void = () => undefined;
		const requestStarted = new Promise<void>((resolve) => {
			signalRequestStarted = resolve;
		});
		let first = true;
		const runner = new ActiveAssessmentRunner(connection.db, {
			fetchImpl: async (_input, init) => {
				if (first) {
					first = false;
					signalRequestStarted();
					await firstRequestGate;
				}
				const status =
					init?.method === "POST" ? 201 : init?.method === "DELETE" ? 204 : 200;
				return new Response(null, { status });
			},
		});
		const request = {
			kind: "transaction",
			engagementId,
			targetConfigId,
			transaction: {
				id: "serialized",
				seed: [
					{
						method: "POST",
						path: "/fixtures",
						headers: {},
						body: null,
						expectedStatus: [201],
					},
				],
				request: {
					method: "PATCH",
					path: "/fixtures/a",
					headers: {},
					body: null,
					expectedStatus: [200],
				},
				cleanup: [
					{
						method: "DELETE",
						path: "/fixtures/a",
						headers: {},
						body: null,
						expectedStatus: [204],
					},
				],
				maxRequests: 3,
			},
		} satisfies RunActiveAssessmentRequest;
		const running = runner.run({
			projectId,
			createdByUserId: userId,
			executionConsent: true,
			request,
		});
		await requestStarted;
		await expect(
			runner.run({
				projectId,
				createdByUserId: userId,
				executionConsent: true,
				request,
			}),
		).rejects.toThrow("active_assessment_project_busy");
		releaseFirstRequest();
		await expect(running).resolves.toMatchObject({ status: "completed" });
	});

	it("fails interrupted active runs closed with unknown cleanup state", async () => {
		const engagementId = await createActiveEngagement({
			connection,
			projectId,
			userId,
			methods: ["POST", "PATCH", "DELETE"],
			paths: ["/fixtures"],
			origin: `http://127.0.0.1:${server.port}`,
		});
		const scan = await new ScanRepository(connection.db).createScanRun({
			projectId,
			profile: "active-lab:transaction",
			status: "running",
			createdByUserId: userId,
		});
		const repository = new ActiveAssessmentRepository(connection.db);
		const activeRun = await repository.createRun({
			projectId,
			scanRunId: scan.id,
			engagementId,
			targetConfigId,
			kind: "transaction",
			createdByUserId: userId,
		});
		await repository.createEvidence({
			activeAssessmentRunId: activeRun.id,
			method: "POST",
			path: "/fixtures",
			statusCode: 201,
			identityRole: null,
			stage: "seed:0",
			requestSha256: "a".repeat(64),
			durationMs: 1,
		});
		expect(
			await new ActiveAssessmentRunner(connection.db).recover(),
		).toBe(1);
		expect(
			await connection.db.query.activeAssessmentRuns.findFirst({
				where: (fields, { eq }) => eq(fields.id, activeRun.id),
			}),
		).toMatchObject({
			status: "failed_cleanup",
			requestCount: 1,
			errorMessage: "interrupted_cleanup_state_unknown",
		});
		expect(await new ScanRepository(connection.db).findById(scan.id)).toMatchObject({
			status: "failed",
		});
	});
});

async function createActiveEngagement(params: {
	connection: DbConnection;
	projectId: string;
	userId: string;
	methods: Array<
		"GET" | "HEAD" | "OPTIONS" | "POST" | "PUT" | "PATCH" | "DELETE"
	>;
	paths: string[];
	origin: string;
	requestBudget?: number;
	purpose?: "internal" | "external";
	environment?: "local" | "ephemeral" | "staging" | "production";
}) {
	const repository = new AssessmentRepository(params.connection.db);
	const engagement = await repository.createEngagement({
		projectId: params.projectId,
		purpose: params.purpose ?? "internal",
		environment: params.environment ?? "ephemeral",
		scope: {
			origins: [params.origin],
			paths: params.paths,
			methods: params.methods,
		},
		rulesOfEngagement: {
			reference: "active-fixture",
			allowedPaths: params.paths,
			allowedMethods: params.methods,
			requestBudget: params.requestBudget ?? 100,
			rateLimitPerSec: 100,
			cleanupContract: "Delete all seeded fixture records.",
			expiresAt: "2099-01-01T00:00:00.000Z",
			attestation: "Owned disposable test fixture.",
		},
		startsAt: "2020-01-01T00:00:00.000Z",
		expiresAt: "2099-01-01T00:00:00.000Z",
		ownerUserId: params.userId,
	});
	await repository.setEngagementStatus(engagement.id, params.userId, "active");
	return engagement.id;
}
