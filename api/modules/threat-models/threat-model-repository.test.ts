import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users } from "../../db/schema";
import { ProjectRepository } from "../scans/repositories";
import { buildApplicationModel } from "./application-model-builder";
import { generateThreatHypotheses } from "./threat-hypothesis-runner";
import { ThreatModelRepository } from "./threat-model-repository";

let connection: DbConnection | null = null;

afterEach(() => {
	connection?.sqlite.close();
	connection = null;
});

describe("ThreatModelRepository", () => {
	test("removes partial hypotheses when completion fails", async () => {
		connection = createDbConnection(":memory:");
		for (const filename of readdirSync(path.resolve("drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort())
			connection.sqlite.exec(
				readFileSync(path.resolve("drizzle", filename), "utf8"),
			);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "threat-repository@example.test",
				displayName: "Threat Repository",
				passwordHash: "test",
			})
			.returning();
		const project = await new ProjectRepository(connection.db).createProject({
			name: "Threat repository",
			repoPath: "/tmp/threat-repository",
			ownerUserId: user.id,
		});
		const model = buildApplicationModel({
			projectId: project.id,
			sources: [
				{
					path: "routes.ts",
					content: 'app.post("/orders", createOrder)',
				},
			],
		});
		const repository = new ThreatModelRepository(connection.db);
		const snapshot = await repository.saveSnapshot({
			model,
			ownerUserId: user.id,
		});
		expect(snapshot).toBeDefined();
		const run = await repository.createRun({
			projectId: project.id,
			modelSnapshotId: snapshot?.id as string,
			ownerUserId: user.id,
		});
		const generated = await generateThreatHypotheses({ model });
		const hypothesis = generated.hypotheses[0];
		expect(hypothesis).toBeDefined();
		await expect(
			repository.completeRun({
				runId: run.id,
				modelSnapshotId: snapshot?.id as string,
				hypotheses: [hypothesis, hypothesis],
				status: "completed",
				llmAvailable: false,
				limitations: [],
			}),
		).rejects.toThrow();
		expect(await repository.findOwnedRun(run.id, user.id)).toMatchObject({
			run: { status: "running" },
			hypotheses: [],
			evidence: [],
		});
	});
});
