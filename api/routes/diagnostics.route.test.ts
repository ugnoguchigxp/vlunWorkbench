import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../db";
import { users } from "../db/schema";
import { HttpError } from "../modules/auth/errors";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import {
	ArtifactRepository,
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import { createDiagnosticsRoute } from "./diagnostics.route";

async function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of (await readdir(migrationsDir))
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b))) {
		connection.sqlite.exec(await readFile(path.join(migrationsDir, filename), "utf8"));
	}
}

describe("Diagnostics route", () => {
	let connection: DbConnection;
	let artifactRoot: string;
	let app: Hono;
	let projectRepo: ProjectRepository;
	let scanRepo: ScanRepository;
	let userId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		await applyMigrations(connection);
		artifactRoot = await mkdtemp(path.join(os.tmpdir(), "diagnostics-route-"));
		projectRepo = new ProjectRepository(connection.db);
		scanRepo = new ScanRepository(connection.db);
		const artifactRepo = new ArtifactRepository(connection.db);
		const artifactStorage = new ArtifactStorage(artifactRoot);
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "diagnostics-route@example.com",
				passwordHash: "hash",
				displayName: "Diagnostics Route User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;
		app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", {
				userId,
				email: "diagnostics-route@example.com",
				role: "member",
			});
			await next();
		});
		app.onError((error, c) => {
			if (error instanceof HttpError) {
				return c.json({ message: error.message }, error.status as never);
			}
			return c.json({ message: (error as Error).message }, 500);
		});
		app.route(
			"/api",
			createDiagnosticsRoute({
				db: connection.db,
				projectRepository: projectRepo,
				scanRepository: scanRepo,
				artifactRepository: artifactRepo,
				artifactStorage,
			}),
		);
	});

	afterEach(async () => {
		connection.sqlite.close(false);
		await rm(artifactRoot, { recursive: true, force: true });
	});

	it("creates and downloads a zero-finding diagnostic report", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Diagnostics Route Project",
			repoPath: process.cwd(),
		});
		const scan = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "detailed-security",
			status: "completed",
			createdByUserId: userId,
			metadata: {},
		});

		const createRes = await app.request(
			`/api/scans/${scan.id}/diagnostic-reports`,
			{
				method: "POST",
				body: JSON.stringify({ kind: "zero-finding" }),
				headers: { "content-type": "application/json" },
			},
		);
		expect(createRes.status).toBe(201);
		const created = await createRes.json();
		expect(created.ok).toBe(true);
		expect(created.reportId).toBeTruthy();

		const downloadRes = await app.request(
			`/api/diagnostic-reports/${created.reportId}/download`,
		);
		expect(downloadRes.status).toBe(200);
		expect(await downloadRes.text()).toContain(
			"Zero Finding Diagnostic Summary",
		);
	});

	it("rejects malformed JSON request bodies", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Diagnostics Route Project",
			repoPath: process.cwd(),
		});
		const scan = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "detailed-security",
			status: "completed",
			createdByUserId: userId,
			metadata: {},
		});

		const res = await app.request(
			`/api/scans/${scan.id}/diagnostic-reports`,
			{
				method: "POST",
				body: "{",
				headers: { "content-type": "application/json" },
			},
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ message: "Invalid JSON request body" });
	});

	it("keeps existing security check results when a scoped check matches nothing", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Diagnostics Route Project",
			repoPath: process.cwd(),
		});
		const scan = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "detailed-security",
			status: "completed",
			createdByUserId: userId,
			metadata: {},
		});

		const initialRun = await app.request(
			`/api/scans/${scan.id}/security-checks/run`,
			{
				method: "POST",
				body: "{}",
				headers: { "content-type": "application/json" },
			},
		);
		expect(initialRun.status).toBe(200);
		expect((await initialRun.json()).resultCount).toBe(10);

		const scopedRun = await app.request(
			`/api/scans/${scan.id}/security-checks/run`,
			{
				method: "POST",
				body: JSON.stringify({ checkId: "missing.check" }),
				headers: { "content-type": "application/json" },
			},
		);
		expect(scopedRun.status).toBe(200);
		expect((await scopedRun.json()).resultCount).toBe(0);

		const listRes = await app.request(
			`/api/scans/${scan.id}/security-checks`,
		);
		expect(listRes.status).toBe(200);
		expect((await listRes.json()).results).toHaveLength(10);
	});
});
