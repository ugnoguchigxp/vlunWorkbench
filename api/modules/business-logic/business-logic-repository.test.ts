import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	applicationModelSnapshots,
	threatHypotheses,
	threatModelRuns,
	users,
} from "../../db/schema";
import { AssessmentRepository } from "../assessments/assessment-repository";
import { ProjectRepository, ScanRepository } from "../scans/repositories";
import { BusinessLogicRepository } from "./business-logic-repository";

function migrate(connection: DbConnection): void {
	for (const filename of readdirSync(path.resolve("drizzle"))
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		connection.sqlite.exec(
			readFileSync(path.resolve("drizzle", filename), "utf8"),
		);
	}
}

const hash = `sha256:${"a".repeat(64)}`;
const scenario = {
	id: "scenario:owner-isolation",
	hypothesisId: "threat:owner-isolation",
	controlId: "owner-isolation",
	engagementId: "00000000-0000-4000-8000-000000000001",
	targetConfigId: "00000000-0000-4000-8000-000000000002",
	actors: [
		{
			actorId: "actor:user",
			authContextId: "00000000-0000-4000-8000-000000000003",
		},
	],
	preconditions: [],
	seed: [],
	actions: [
		{
			actorId: "actor:user",
			method: "GET",
			path: "/orders/1",
			headers: {},
			body: null,
			expectedStatus: [200],
		},
	],
	invariants: [{ kind: "status_class", requestIndex: 0, expectedClass: 2 }],
	cleanup: [
		{
			actorId: "actor:user",
			method: "DELETE",
			path: "/orders/1",
			headers: {},
			body: null,
			expectedStatus: [204],
		},
	],
	maxRequests: 4,
	timeoutSec: 30,
	expectedBaselineHash: null,
};

describe("BusinessLogicRepository", () => {
	let connection: DbConnection;
	let business: BusinessLogicRepository;
	let ownerUserId: string;
	let projectId: string;
	let hypothesisId: string;
	let engagementId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		migrate(connection);
		business = new BusinessLogicRepository(connection.db);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "logic@example.com",
				passwordHash: "hash",
				displayName: "Logic",
				role: "member",
				isActive: true,
			})
			.returning();
		ownerUserId = user.id;
		const project = await new ProjectRepository(connection.db).createProject({
			ownerUserId,
			name: "Logic",
			repoPath: "/tmp/logic",
		});
		projectId = project.id;
		const [snapshot] = await connection.db
			.insert(applicationModelSnapshots)
			.values({
				projectId,
				ownerUserId,
				sourceFingerprint: "fp",
				snapshotHash: hash,
				model: { unresolvedSuggestions: [] } as never,
			})
			.returning();
		const [run] = await connection.db
			.insert(threatModelRuns)
			.values({
				projectId,
				modelSnapshotId: snapshot.id,
				ownerUserId,
				status: "completed",
			})
			.returning();
		const [hypothesis] = await connection.db
			.insert(threatHypotheses)
			.values({
				runId: run.id,
				modelSnapshotId: snapshot.id,
				externalId: "threat:owner-isolation",
				category: "business_logic",
				status: "hypothesis",
				validationKind: "bounded_transaction",
				hypothesis: {
					id: "threat:owner-isolation",
					title: "isolation",
				} as never,
			})
			.returning();
		hypothesisId = hypothesis.id;
		const engagement = await new AssessmentRepository(
			connection.db,
		).createEngagement({
			projectId,
			ownerUserId,
			purpose: "internal",
			environment: "local",
			scope: {
				origins: ["http://127.0.0.1:3000"],
				paths: ["/"],
				methods: ["GET", "DELETE"],
			},
			rulesOfEngagement: null,
			startsAt: "2020-01-01T00:00:00.000Z",
			expiresAt: "2099-01-01T00:00:00.000Z",
		});
		engagementId = engagement.id;
	});

	afterEach(() => {
		connection.sqlite.close(false);
	});

	it("persists scenarios, runs, evidence, and interrupted cleanup", async () => {
		expect(
			await business.findOwnedHypothesis(
				projectId,
				ownerUserId,
				"threat:owner-isolation",
			),
		).not.toBeNull();
		const saved = await business.saveScenario({
			projectId,
			ownerUserId,
			hypothesisRecordId: hypothesisId,
			planHash: "plan-1",
			scenario: {
				...scenario,
				engagementId,
			} as never,
		});
		expect(saved?.id).toBeTruthy();
		expect(
			await business.findOwnedScenario(saved!.id, ownerUserId),
		).toMatchObject({ id: saved!.id });
		expect(await business.listOwnedScenarios(projectId, ownerUserId)).toHaveLength(
			1,
		);
		const scan = await new ScanRepository(connection.db).createScanRun({
			projectId,
			profile: "business-logic-lab",
			status: "running",
			createdByUserId: ownerUserId,
		});
		const run = await business.createRun({
			scenarioId: saved!.id,
			projectId,
			scanRunId: scan.id,
		});
		await business.createEvidence({
			runId: run.id,
			stage: "action",
			method: "GET",
			path: "/orders/1",
			statusCode: 200,
			requestSha256: hash,
			durationMs: 5,
		});
		expect(await business.sumEngagementRequests(engagementId)).toBe(0);
		expect(await business.hasUnresolvedCleanup(projectId)).toBe(false);
		expect(await business.failInterruptedRuns()).toBe(1);
		expect(await business.hasUnresolvedCleanup(projectId)).toBe(true);
		expect(
			await business.completeRun(run.id, {
				status: "completed",
				requestCount: 2,
				findingCount: 0,
				cleanupSucceeded: true,
				result: { ok: true },
			}),
		).toMatchObject({ status: "completed" });
		expect(await business.sumEngagementRequests(engagementId)).toBe(2);
	});
});
