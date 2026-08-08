import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAppEnv } from "../app/env";
import { HttpError } from "../modules/auth/errors";
import { createProjectsRoute } from "./projects.route";

describe("Projects diff scan routes", () => {
	let tempRoot: string;
	let repoPath: string;
	let app: Hono;
	let scanRepository: {
		createScanRun: ReturnType<typeof vi.fn>;
		createScanEvent: ReturnType<typeof vi.fn>;
	};
	let scanSupervisor: { launch: ReturnType<typeof vi.fn> };

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "projects-diff-route-"));
		repoPath = path.join(tempRoot, "repo");
		await fs.mkdir(repoPath);
		git(["init", "-b", "main"]);
		git(["config", "user.email", "test@example.com"]);
		git(["config", "user.name", "Test User"]);
		await fs.mkdir(path.join(repoPath, "src"));
		await fs.writeFile(path.join(repoPath, "src/app.ts"), "export const a = 1;\n");
		git(["add", "-A"]);
		git(["commit", "-m", "base"]);
		await fs.writeFile(path.join(repoPath, "src/app.ts"), "export const a = 2;\n");

		const projectRepository = {
			findById: vi.fn(async (id: string) =>
				id === "p-1"
					? {
							id,
							ownerUserId: "user-1",
							name: "Diff Project",
							repoPath,
							defaultBranch: "main",
						}
					: null,
			),
			listProjects: vi.fn(async () => []),
			findByCanonicalRepoPath: vi.fn(async () => null),
			findByRepoPath: vi.fn(async () => null),
			createProject: vi.fn(),
		};
		scanRepository = {
			createScanRun: vi.fn(async () => ({ id: "scan-1" })),
			createScanEvent: vi.fn(async () => ({ id: "event-1" })),
		};
		scanSupervisor = {
			launch: vi.fn(async () => undefined),
		};
		app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", {
				userId: "user-1",
				email: "user@example.com",
				role: "member",
			});
			await next();
		});
		app.onError((error, c) => {
			if (error instanceof HttpError) {
				return c.json({ message: error.message }, error.status as 400);
			}
			return c.json(
				{ message: error instanceof Error ? error.message : String(error) },
				500,
			);
		});
		app.route(
			"/",
			createProjectsRoute({
				projectRepository: projectRepository as never,
				scanRepository: scanRepository as never,
				scanSupervisor: scanSupervisor as never,
				env: readAppEnv({ NODE_ENV: "test" }),
			}),
		);
	});

	afterEach(async () => {
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("previews a working-tree target without creating a scan", async () => {
		const response = await app.request("/p-1/scans/preview", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profile: "diff-source-baseline",
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({
			target: {
				kind: "working_tree",
				targetDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
			},
			coverage: { changed: 1, scannable: 1 },
			pluginContext: {
				detectedPluginIds: ["language.typescript"],
				affectedPluginIds: expect.arrayContaining(["language.typescript"]),
			},
			entries: [
				{
					status: "modified",
					path: "src/app.ts",
					disposition: "scan",
				},
			],
		});
		expect(body.entries[0].contentSha256).toBeUndefined();
		expect(scanRepository.createScanRun).not.toHaveBeenCalled();
	});

	it("previews commit and range targets with the same structured contract", async () => {
		git(["add", "-A"]);
		git(["commit", "-m", "change"]);
		for (const target of [
			{ kind: "commit", head: "HEAD" },
			{ kind: "range", base: "HEAD^", head: "HEAD" },
		]) {
			const response = await app.request("/p-1/scans/preview", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					profile: "diff-source-baseline",
					target,
				}),
			});

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toMatchObject({
				target: {
					kind: target.kind,
					targetDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				},
				coverage: { changed: 1, scannable: 1 },
				entries: [
					{
						status: "modified",
						path: "src/app.ts",
						disposition: "scan",
					},
				],
			});
		}
		expect(scanRepository.createScanRun).not.toHaveBeenCalled();
	});

	it("requires the preview digest and launches a working-tree scan with structured args", async () => {
		const previewResponse = await app.request("/p-1/scans/preview", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profile: "diff-source-baseline",
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
		});
		const preview = await previewResponse.json();

		const missingDigest = await app.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profile: "diff-source-baseline",
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
		});
		expect(missingDigest.status).toBe(400);

		const response = await app.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profile: "diff-source-baseline",
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
				expectedTargetDigest: preview.target.targetDigest,
			}),
		});

		expect(response.status).toBe(202);
		expect(scanRepository.createScanRun).toHaveBeenCalledWith(
			expect.objectContaining({
				profile: "diff-source-baseline",
				metadata: expect.objectContaining({
					requestedTarget: expect.objectContaining({
						kind: "working_tree",
					}),
					expectedTargetDigest: preview.target.targetDigest,
				}),
			}),
		);
		expect(scanSupervisor.launch).toHaveBeenCalledWith(
			"scan-1",
			expect.arrayContaining([
				"--target",
				"working-tree",
				"--base",
				"HEAD",
				"--expected-target-digest",
				preview.target.targetDigest,
			]),
		);
	});

	it("rejects a diff digest on a legacy full scan", async () => {
		const response = await app.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profile: "baseline",
				target: { kind: "full" },
				expectedTargetDigest: "a".repeat(64),
			}),
		});

		expect(response.status).toBe(400);
		expect(scanRepository.createScanRun).not.toHaveBeenCalled();
	});

	function git(args: string[]): string {
		return execFileSync("git", args, { cwd: repoPath, encoding: "utf8" });
	}
});
