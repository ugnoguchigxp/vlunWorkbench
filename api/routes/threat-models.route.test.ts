import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AppEnv } from "../app/env";
import { createDbConnection, type DbConnection } from "../db";
import { users } from "../db/schema";
import { HttpError } from "../modules/auth/errors";
import { ProjectRepository } from "../modules/scans/repositories";
import { buildApplicationModel } from "../modules/threat-models/application-model-builder";
import { ThreatModelRepository } from "../modules/threat-models/threat-model-repository";
import { createThreatModelsRoute } from "./threat-models.route";

describe("threat model routes", () => {
	let connection: DbConnection;
	let projectRepository: ProjectRepository;
	let app: Hono;
	let ownerUserId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const filename of readdirSync(path.resolve("drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort())
			connection.sqlite.exec(
				readFileSync(path.resolve("drizzle", filename), "utf8"),
			);
		const [owner] = await connection.db
			.insert(users)
			.values({
				email: "threat-route@example.test",
				displayName: "Threat route",
				passwordHash: "hash",
			})
			.returning();
		ownerUserId = owner.id;
		projectRepository = new ProjectRepository(connection.db);
		app = new Hono();
		app.use("*", async (context, next) => {
			context.set("authUser", {
				userId: ownerUserId,
				email: "threat-route@example.test",
				role: "member",
			});
			await next();
		});
		app.onError((error, context) =>
			error instanceof HttpError
				? context.json({ message: error.message }, error.status as never)
				: context.json({ message: (error as Error).message }, 500),
		);
		app.route(
			"/api",
			createThreatModelsRoute({
				db: connection.db,
				env: { threatModelEnabled: true } as AppEnv,
				projectRepository,
			}),
		);
	});

	afterEach(() => connection.sqlite.close());

	test("lists historical runs when the current project source is unavailable", async () => {
		const project = await projectRepository.createProject({
			name: "Unavailable source",
			repoPath: "/path/that/does/not/exist",
			ownerUserId,
		});
		const repository = new ThreatModelRepository(connection.db);
		const snapshot = await repository.saveSnapshot({
			ownerUserId,
			model: buildApplicationModel({
				projectId: project.id,
				sources: [
					{
						path: "routes.ts",
						content: 'app.get("/historical", handler)',
					},
				],
			}),
		});
		const run = await repository.createRun({
			projectId: project.id,
			modelSnapshotId: snapshot?.id as string,
			ownerUserId,
		});
		await repository.failRun(run.id, "historical_failure");

		const response = await app.request(
			`/api/projects/${project.id}/threat-model-runs`,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			currentSourceFingerprint: null,
			refreshLimitationCode: "application_model_refresh_failed",
			runs: [{ id: run.id, current: false }],
		});
	});
});
