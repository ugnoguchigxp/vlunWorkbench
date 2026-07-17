import fs from "node:fs/promises";
import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createProjectSchema } from "../../shared/schemas/scan.schema";
import type { AppEnv } from "../app/env";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import { isTemporaryProjectPath } from "../modules/scans/project-visibility";
import {
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
import type { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";

type ProjectsRouteDeps = {
	projectRepository: ProjectRepository;
	scanRepository?: ScanRepository;
	scanSupervisor?: ScanProcessSupervisor;
	env?: AppEnv;
};

export function createProjectsRoute(deps: ProjectsRouteDeps) {
	const repo = deps.projectRepository;

	return new Hono()
		.get("/", async (c) => {
			const authUser = getAuthContextUser(c);
			const list = await repo.listProjects(authUser.userId);
			return c.json({
				projects: list.filter(
					(project) => !isTemporaryProjectPath(project.repoPath),
				),
			});
		})
		.post("/folder-picker", async (c) => {
			getAuthContextUser(c);
			if (process.platform !== "darwin") {
				throw new HttpError(
					400,
					"Folder picker is only available on macOS in this local build.",
				);
			}

			const script =
				'POSIX path of (choose folder with prompt "Select a project folder to scan")';
			const proc = Bun.spawn(["osascript", "-e", script], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await proc.exited;
			const stdoutText = await new Response(proc.stdout).text();
			const stderrText = await new Response(proc.stderr).text();

			if (exitCode !== 0) {
				if (stderrText.toLowerCase().includes("user canceled")) {
					return c.json({ path: null });
				}
				throw new HttpError(
					500,
					stderrText.trim() || "Folder picker failed to open.",
				);
			}

			const selectedPath = stdoutText.trim();
			return c.json({
				path: selectedPath ? path.resolve(selectedPath) : null,
			});
		})
		.get("/:projectId", async (c) => {
			const authUser = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			const project = await repo.findById(projectId);
			if (!project) {
				throw new HttpError(404, "Project not found");
			}
			if (project.ownerUserId !== authUser.userId) {
				throw new HttpError(403, "Forbidden");
			}
			return c.json({ project });
		})
		.post("/", zValidator("json", createProjectSchema), async (c) => {
			const authUser = getAuthContextUser(c);
			const body = c.req.valid("json");

			// Check repo path exists on disk
			const requestedPath = path.resolve(body.repoPath);
			let resolvedPath: string;
			try {
				await fs.access(requestedPath);
				resolvedPath = await fs.realpath(requestedPath);
			} catch {
				throw new HttpError(
					400,
					`Repository path does not exist on disk: ${body.repoPath}`,
				);
			}

			// canonical path is globally unique so path aliases resolve to one project.
			const existing =
				(await repo.findByCanonicalRepoPath(resolvedPath)) ??
				(await repo.findByRepoPath(authUser.userId, resolvedPath));
			if (existing) {
				throw new HttpError(
					400,
					"A project with this repository path is already registered.",
				);
			}

			const created = await repo.createProject({
				ownerUserId: authUser.userId,
				name: path.basename(resolvedPath) || "repository",
				repoPath: resolvedPath,
				canonicalRepoPath: resolvedPath,
				defaultBranch: body.defaultBranch,
				metadata: body.metadata,
			});

			return c.json({ project: created }, 201);
		})
		.post(
			"/:projectId/scans",
			zValidator(
				"json",
				z.object({
					profile: z.string().default("baseline"),
					continueOnToolFailure: z.boolean().default(true).optional(),
					timeoutSec: z.number().int().positive().optional(),
					runner: z.enum(["host", "docker"]).default("host").optional(),
					dockerBin: z.string().optional(),
					dockerImage: z.string().optional(),
					network: z.enum(["none", "default"]).default("none").optional(),
					memory: z.string().optional(),
					cpus: z.string().optional(),
					toolCacheDir: z.string().optional(),
					imageRef: z.string().optional(),
					imageTar: z.string().optional(),
					finalReport: z.boolean().default(true).optional(),
					reportTitle: z.string().optional(),
				}),
			),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const projectId = c.req.param("projectId");
				const body = c.req.valid("json");

				const project = await repo.findById(projectId);
				if (!project) {
					throw new HttpError(404, "Project not found");
				}
				if (project.ownerUserId !== authUser.userId) {
					throw new HttpError(403, "Forbidden");
				}

				if (!deps.scanRepository || !deps.scanSupervisor || !deps.env) {
					throw new HttpError(500, "Scan runtime is not configured.");
				}
				const policy = resolveScanExecutionPolicy({
					env: deps.env,
					surface: "web",
					requestedRunner: body.runner,
				});
				const queued = await deps.scanRepository.createScanRun({
					projectId,
					profile: body.profile,
					status: "queued",
					createdByUserId: authUser.userId,
					metadata: {
						launchSource: "web",
						executionPolicy: scanExecutionPolicyMetadata(policy),
					},
				});
				await deps.scanRepository.createScanEvent({
					scanRunId: queued.id,
					level: "info",
					eventType: "scan.queued",
					message: `Scan profile ${body.profile} queued.`,
					data: { executionPolicy: scanExecutionPolicyMetadata(policy) },
				});

				const args = [
					"bun",
					"run",
					"api/cli/scan-profile.ts",
					"--scan-run-id",
					queued.id,
					"--execution-surface",
					"web",
					"--project-id",
					projectId,
					"--profile",
					body.profile,
					"--continue-on-tool-failure",
					String(body.continueOnToolFailure ?? true),
					"--runner",
					policy.runner,
					"--final-report",
					String(body.finalReport ?? true),
				];

				if (body.timeoutSec !== undefined) {
					args.push("--timeout-sec", String(body.timeoutSec));
				}
				if (body.imageRef) args.push("--image-ref", body.imageRef);
				if (body.imageTar) args.push("--image-tar", body.imageTar);
				if (body.reportTitle) {
					args.push("--report-title", body.reportTitle);
				}

				await deps.scanSupervisor.launch(queued.id, args);
				return c.json(
					{
						scan: { id: queued.id, status: "queued", profile: body.profile },
						runner: policy.runner,
						profileOutcome: "pending",
						toolResults: [],
						stepResults: [],
					},
					202,
				);
			},
		);
}
