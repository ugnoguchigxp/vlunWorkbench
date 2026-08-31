import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../db";
import { users } from "../db/schema";
import { HttpError } from "../modules/auth/errors";
import { DastRepository } from "../modules/dast/dast-repository";
import {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import { createDastRoute } from "./dast.route";

function streamText(text: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});
}

describe("DAST route", () => {
	let connection: DbConnection;
	let app: Hono;
	let projectRepo: ProjectRepository;
	let dastRepo: DastRepository;
	let userId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		for (const filename of readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b))) {
			connection.sqlite.exec(readFileSync(path.join(migrationsDir, filename), "utf8"));
		}
		projectRepo = new ProjectRepository(connection.db);
		dastRepo = new DastRepository(connection.db);
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "route@example.com",
				passwordHash: "hash",
				displayName: "Route User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;
		app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", { userId, email: "route@example.com", role: "member" });
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
			createDastRoute({
				db: connection.db,
				projectRepository: projectRepo,
			}),
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		connection.sqlite.close(false);
	});

	it("creates and lists project DAST targets", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Route Project",
			repoPath: process.cwd(),
		});
		const createRes = await app.request(
			`/api/projects/${project.id}/dast-targets`,
			{
				method: "POST",
				body: JSON.stringify({
					name: "local",
					origin: "http://127.0.0.1:3000",
				}),
				headers: { "content-type": "application/json" },
			},
		);
		expect(createRes.status).toBe(201);
		const listRes = await app.request(`/api/projects/${project.id}/dast-targets`);
		const body = await listRes.json();
		expect(body.targets).toHaveLength(1);
	});

	it("rejects unsafe DAST targets before persisting them", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Unsafe Target Project",
			repoPath: process.cwd(),
		});
		const createRes = await app.request(
			`/api/projects/${project.id}/dast-targets`,
			{
				method: "POST",
				body: JSON.stringify({
					name: "public",
					origin: "http://8.8.8.8",
				}),
				headers: { "content-type": "application/json" },
			},
		);
		expect(createRes.status).toBe(400);
		const listRes = await app.request(`/api/projects/${project.id}/dast-targets`);
		const body = await listRes.json();
		expect(body.targets).toHaveLength(0);
	});

	it("rejects DAST profile routes that broaden target scope", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Scoped Profile Project",
			repoPath: process.cwd(),
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local-app",
			origin: "http://127.0.0.1:3000",
			allowedPathsJson: ["/app"],
		});
		const res = await app.request(`/api/projects/${project.id}/dast-profiles`, {
			method: "POST",
			body: JSON.stringify({
				targetConfigId: target.id,
				profileId: "browser-smoke",
				displayName: "Browser smoke",
				routePathsJson: ["/apple"],
			}),
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(400);
	});

	it("rejects run requests without saved target/profile IDs", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "No URL Project",
			repoPath: process.cwd(),
		});
		const res = await app.request(`/api/projects/${project.id}/dast-runs`, {
			method: "POST",
			body: JSON.stringify({ url: "http://127.0.0.1:3000" }),
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(400);
	});

	it("rejects an unavailable project path before validating a DAST run", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Missing Path Project",
			repoPath: path.join(process.cwd(), ".tmp", "missing-dast-route-project"),
		});
		const res = await app.request(`/api/projects/${project.id}/dast-runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()).message).toContain("does not exist");
	});

	it("rejects mock runners on the external DAST API", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "No Mock DAST Project",
			repoPath: process.cwd(),
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		const spawn = vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("mock runner reached the CLI bridge");
		});
		const res = await app.request(`/api/projects/${project.id}/dast-runs`, {
			method: "POST",
			body: JSON.stringify({
				targetConfigId: target.id,
				profileId: "browser-smoke",
				runner: "mock",
			}),
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(400);
		expect(spawn).not.toHaveBeenCalled();
		expect((await res.json()).message).toContain("runner");
	});

	it("launches scan-dast through an argv array", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Bridge Project",
			repoPath: process.cwd(),
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		const spawn = vi.spyOn(Bun, "spawn").mockReturnValue({
			stdout: streamText(
				JSON.stringify({
					ok: true,
					dastRunId: "33333333-3333-4333-8333-333333333333",
					scanRunId: "44444444-4444-4444-8444-444444444444",
					status: "completed",
					outcome: "passed",
					coverageStatus: "covered",
					artifactIds: [],
					findingIds: [],
					evidenceIds: [],
					summary: "ok",
				}),
			),
			stderr: streamText(""),
			exited: Promise.resolve(0),
		} as never);
		const res = await app.request(`/api/projects/${project.id}/dast-runs`, {
			method: "POST",
			body: JSON.stringify({
				targetConfigId: target.id,
				profileId: "http-baseline",
				runner: "host",
				dryRun: true,
			}),
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(200);
		expect(spawn).toHaveBeenCalledTimes(1);
		const args = spawn.mock.calls[0][0] as string[];
		expect(args.slice(0, 4)).toEqual(["bun", "run", "api/cli/scan-dast.ts", "--"]);
		expect(args).toContain("--target-config-id");
		expect(args).toContain("--created-by-user-id");
		expect(args).toContain(userId);
		expect(args).not.toContain("http://127.0.0.1:3000");
	});

	it("records authenticated-web launches under the canonical scan profile", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Authenticated Web Project",
			repoPath: process.cwd(),
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		vi.spyOn(Bun, "spawn").mockReturnValue({
			stdout: streamText(
				JSON.stringify({
					ok: true,
					dastRunId: "33333333-3333-4333-8333-333333333333",
					scanRunId: "44444444-4444-4444-8444-444444444444",
					status: "completed",
					outcome: "passed",
					coverageStatus: "covered",
				}),
			),
			stderr: streamText(""),
			exited: Promise.resolve(0),
		} as never);

		const res = await app.request(`/api/projects/${project.id}/dast-runs`, {
			method: "POST",
			body: JSON.stringify({
				targetConfigId: target.id,
				profileId: "authenticated-readonly-standard",
				catalogProfileId: "authenticated-web",
				authContextId: "55555555-5555-4555-8555-555555555555",
				identityRole: "test-user",
				runner: "host",
			}),
			headers: { "content-type": "application/json" },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		const scan = await new ScanRepository(connection.db).findById(body.scanRunId);
		expect(scan).toEqual(
			expect.objectContaining({
				projectId: project.id,
				profile: "authenticated-web",
				status: "completed",
				profileOutcome: "completed",
				metadata: expect.objectContaining({
					profileResolution: expect.objectContaining({
						canonicalProfileId: "authenticated-web",
						launchMode: "dedicated_flow",
					}),
				}),
			}),
		);
	});

	it("fails the canonical authenticated-web row when the CLI cannot launch", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Failed Authenticated Web Project",
			repoPath: process.cwd(),
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("spawn failed");
		});

		const res = await app.request(`/api/projects/${project.id}/dast-runs`, {
			method: "POST",
			body: JSON.stringify({
				targetConfigId: target.id,
				profileId: "authenticated-readonly-standard",
				catalogProfileId: "authenticated-web",
				authContextId: "55555555-5555-4555-8555-555555555555",
				identityRole: "test-user",
				runner: "host",
			}),
			headers: { "content-type": "application/json" },
		});

		expect(res.status).toBe(500);
		const scans = await new ScanRepository(connection.db).listScanRuns(project.id);
		expect(scans).toHaveLength(1);
		expect(scans[0]).toEqual(
			expect.objectContaining({
				profile: "authenticated-web",
				status: "failed",
				profileOutcome: "failed",
			}),
		);
	});

	it("rejects a canonical authenticated-web launch that downgrades its engine or omits authentication", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Invalid Authenticated Web Project",
			repoPath: process.cwd(),
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});

		for (const request of [
			{
				targetConfigId: target.id,
				profileId: "http-baseline",
				catalogProfileId: "authenticated-web",
				authContextId: "55555555-5555-4555-8555-555555555555",
				identityRole: "test-user",
			},
			{
				targetConfigId: target.id,
				profileId: "authenticated-readonly-standard",
				catalogProfileId: "authenticated-web",
			},
		]) {
			const response = await app.request(
				`/api/projects/${project.id}/dast-runs`,
				{
					method: "POST",
					body: JSON.stringify(request),
					headers: { "content-type": "application/json" },
				},
			);
			expect(response.status).toBe(400);
		}

		expect(
			await new ScanRepository(connection.db).listScanRuns(project.id),
		).toHaveLength(0);
	});

	it("launches auto-target DAST without requiring a saved target", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Auto Target Project",
			repoPath: process.cwd(),
		});
		const spawn = vi.spyOn(Bun, "spawn").mockReturnValue({
			stdout: streamText(
				JSON.stringify({
					ok: true,
					dastRunId: "55555555-5555-4555-8555-555555555555",
					scanRunId: "66666666-6666-4666-8666-666666666666",
					status: "completed",
					outcome: "passed",
					artifactIds: [],
					findingIds: [],
					evidenceIds: [],
					summary: "ok",
				}),
			),
			stderr: streamText(""),
			exited: Promise.resolve(0),
		} as never);
		const res = await app.request(`/api/projects/${project.id}/dast-runs`, {
			method: "POST",
			body: JSON.stringify({
				autoTarget: true,
				profileId: "http-baseline",
				runner: "host",
				dryRun: true,
			}),
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(200);
		const args = spawn.mock.calls[0][0] as string[];
		expect(args).toContain("--auto-target");
		expect(args).toContain("true");
		expect(args).not.toContain("--target-config-id");
	});

	it("bounds DAST CLI output captured by the Web bridge", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Bounded Bridge Project",
			repoPath: process.cwd(),
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "local",
			origin: "http://127.0.0.1:3000",
		});
		const kill = vi.fn();
		vi.spyOn(Bun, "spawn").mockReturnValue({
			stdout: streamText("x".repeat(1024 * 1024 + 1)),
			stderr: streamText(""),
			exited: Promise.resolve(1),
			kill,
		} as never);

		const res = await app.request(`/api/projects/${project.id}/dast-runs`, {
			method: "POST",
			body: JSON.stringify({
				targetConfigId: target.id,
				profileId: "http-baseline",
				runner: "host",
				dryRun: true,
			}),
			headers: { "content-type": "application/json" },
		});

		expect(res.status).toBe(500);
		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect((await res.json()).message).toContain("stdout");
	});

	it("maps a terminal legacy passed row to unknown coverage", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Legacy DAST Project",
			repoPath: process.cwd(),
		});
		const scanRun = await new ScanRepository(connection.db).createScanRun({
			projectId: project.id,
			profile: "dast:http-baseline",
			status: "completed",
			createdByUserId: userId,
		});
		const target = await dastRepo.createTargetConfig({
			projectId: project.id,
			name: "legacy",
			origin: "http://127.0.0.1:3000",
		});
		await dastRepo.createRun({
			projectId: project.id,
			scanRunId: scanRun.id,
			targetConfigId: target.id,
			profileId: "http-baseline",
			dastKind: "http",
			targetOrigin: target.normalizedOrigin,
			runnerOrigin: target.normalizedOrigin,
			status: "completed",
			outcome: "passed",
		});

		const response = await app.request(
			`/api/projects/${project.id}/dast-runs`,
		);
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.dastRuns[0]).toEqual(
			expect.objectContaining({
				outcome: "passed",
				verdict: "unknown_legacy",
				coverageStatus: "gap",
				limitationCodes: ["unknown_legacy_coverage"],
			}),
		);
	});
});
