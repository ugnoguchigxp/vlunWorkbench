import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../app/env";
import { createDbConnection, type DbConnection } from "../db";
import { dastAuthContexts, users } from "../db/schema";
import { HttpError } from "../modules/auth/errors";
import { DastRepository } from "../modules/dast/dast-repository";
import { ProjectRepository } from "../modules/scans/repositories";
import { createDastAuthRoute } from "./dast-auth.route";

describe("DAST auth route", () => {
	let connection: DbConnection;
	let app: Hono;
	let projectRepository: ProjectRepository;
	let dastRepository: DastRepository;
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
					email: "dast-auth-owner@example.com",
					passwordHash: "hash",
					displayName: "DAST auth owner",
					role: "member",
					isActive: true,
				},
				{
					email: "dast-auth-other@example.com",
					passwordHash: "hash",
					displayName: "DAST auth other",
					role: "member",
					isActive: true,
				},
			])
			.returning();
		ownerUserId = owner.id;
		otherUserId = other.id;
		currentUserId = ownerUserId;
		projectRepository = new ProjectRepository(connection.db);
		dastRepository = new DastRepository(connection.db);
		app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", {
				userId: currentUserId,
				email: "dast-auth@example.com",
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
			createDastAuthRoute({
				db: connection.db,
				env: {
					dastAuthEncryptionKey: Buffer.alloc(32, 7).toString("base64"),
					dastAuthPreviousEncryptionKeys: [],
				} as unknown as AppEnv,
				projectRepository,
			}),
		);
	});

	afterEach(() => connection.sqlite.close());

	it("never returns or stores the credential canary in plaintext", async () => {
		const project = await projectRepository.createProject({
			ownerUserId,
			name: "DAST auth fixture",
			repoPath: "/tmp/dast-auth-fixture",
		});
		const target = await dastRepository.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		const canary = "route-credential-canary";
		const response = await app.request(
			`/api/projects/${project.id}/dast-auth-contexts`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					targetConfigId: target.id,
					identityRole: "user-a",
					label: "User A",
					secret: { kind: "bearer_token", token: canary },
					loginFlow: [],
					expiresAt: "2099-01-01T00:00:00.000Z",
				}),
			},
		);
		expect(response.status).toBe(201);
		expect(await response.text()).not.toContain(canary);
		const rows = await connection.db.select().from(dastAuthContexts);
		expect(JSON.stringify(rows)).not.toContain(canary);
		const listed = await app.request(
			`/api/projects/${project.id}/dast-auth-contexts`,
		);
		expect(await listed.text()).not.toContain(canary);

		currentUserId = otherUserId;
		expect(
			(
				await app.request(
					`/api/projects/${project.id}/dast-auth-contexts`,
				)
			).status,
		).toBe(403);
	});

	it("rejects cookies and storage state for another target", async () => {
		const project = await projectRepository.createProject({
			ownerUserId,
			name: "DAST auth scope fixture",
			repoPath: "/tmp/dast-auth-scope-fixture",
		});
		const target = await dastRepository.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		for (const secret of [
			{
				kind: "cookie_set",
				cookies: [
					{
						name: "sid",
						value: "secret",
						domain: "other.internal",
						path: "/",
					},
				],
			},
			{
				kind: "playwright_storage_state",
				storageState: {
					cookies: [],
					origins: [
						{
							origin: "http://other.internal",
							localStorage: [{ name: "token", value: "secret" }],
						},
					],
				},
			},
		]) {
			const response = await app.request(
				`/api/projects/${project.id}/dast-auth-contexts`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						targetConfigId: target.id,
						identityRole: "user-a",
						label: "User A",
						secret,
						loginFlow: [],
						expiresAt: "2099-01-01T00:00:00.000Z",
					}),
				},
			);
			expect(response.status).toBe(400);
		}
	});

	it("lists without a key and follows a key configured at runtime", async () => {
		const env = {
			dastAuthEncryptionKey: undefined,
			dastAuthPreviousEncryptionKeys: [],
		} as unknown as AppEnv;
		const runtimeApp = new Hono();
		runtimeApp.use("*", async (c, next) => {
			c.set("authUser", {
				userId: ownerUserId,
				email: "dast-auth@example.com",
				role: "member",
			});
			await next();
		});
		runtimeApp.onError((error, c) =>
			error instanceof HttpError
				? c.json({ message: error.message }, error.status as never)
				: c.json({ message: (error as Error).message }, 500),
		);
		runtimeApp.route(
			"/api",
			createDastAuthRoute({
				db: connection.db,
				env,
				projectRepository,
			}),
		);
		const project = await projectRepository.createProject({
			ownerUserId,
			name: "Runtime DAST auth fixture",
			repoPath: "/tmp/runtime-dast-auth-fixture",
		});
		const target = await dastRepository.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		const url = `/api/projects/${project.id}/dast-auth-contexts`;

		expect((await runtimeApp.request(url)).status).toBe(200);
		const body = JSON.stringify({
			targetConfigId: target.id,
			identityRole: "user-a",
			label: "User A",
			secret: { kind: "bearer_token", token: "runtime-secret" },
			loginFlow: [],
			expiresAt: "2099-01-01T00:00:00.000Z",
		});
		const unavailable = await runtimeApp.request(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		expect(unavailable.status).toBe(409);
		expect(await unavailable.text()).toContain("Settings");

		env.dastAuthEncryptionKey = Buffer.alloc(32, 11).toString("base64");
		expect(
			(
				await runtimeApp.request(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body,
				})
			).status,
		).toBe(201);
	});
});
