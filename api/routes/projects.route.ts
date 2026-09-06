import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createProjectSchema } from "../../shared/schemas/scan.schema";
import type { AppEnv } from "../app/env";
import { requireAdmin } from "../middleware/auth";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { WebProcessCapacity } from "../modules/processes/web-process-capacity";
import type { RuntimeIsolationProviderFactory } from "../modules/runtime-isolation/runtime-isolation-provider-factory";
import { materializeScopedSourceSnapshot } from "../modules/scans/execution/lifecycle/full-source-snapshot";
import type { ScanLaunchAttemptRepository } from "../modules/scans/execution/scan-launch-attempt-repository";
import { resolveFullScanTarget } from "../modules/scans/full-scan-target";
import type { ProjectDeletionService } from "../modules/scans/project-deletion-service";
import { isTemporaryProjectPath } from "../modules/scans/project-visibility";
import type {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import type { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";
import {
	ProjectPathPolicyError,
	resolveProjectPath,
} from "../security/project-path-policy";
import { runBoundedCliProcess } from "./cli-process-bridge";
import { createProjectScanRoutes } from "./project-scan.route";

const FOLDER_PICKER_TIMEOUT_MS = 10 * 60 * 1_000;
const FOLDER_PICKER_OUTPUT_LIMIT_BYTES = 64 * 1_024;
const _ABSOLUTE_WEB_SCAN_STEP_TIMEOUT_MAX_SEC = 86_400;

export type ProjectsRouteDeps = {
	projectRepository: ProjectRepository;
	scanRepository?: ScanRepository;
	scanLaunchAttemptRepository?: ScanLaunchAttemptRepository;
	scanSupervisor?: ScanProcessSupervisor;
	processCapacity?: WebProcessCapacity;
	env?: AppEnv;
	/** Reads the persisted runtime settings for each preflight/start request. */
	resolveRuntimeEnv?: () => Promise<AppEnv>;
	/** Undefined keeps lightweight route tests and legacy embedders unchanged. */
	runtimeIsolationProviderFactory?: RuntimeIsolationProviderFactory | null;
	/** Resolves current SQLite-backed settings for each preflight request. */
	resolveRuntimeIsolationProviderFactory?: (
		env: AppEnv,
	) => RuntimeIsolationProviderFactory | null;
	projectDeletionService?: ProjectDeletionService;
	resolveProjectPath?: typeof resolveProjectPath;
	resolveFullScanTarget?: typeof resolveFullScanTarget;
	materializeScopedSourceSnapshot?: typeof materializeScopedSourceSnapshot;
};

export function createProjectsRoute(deps: ProjectsRouteDeps) {
	const repo = deps.projectRepository;
	const resolvePath = deps.resolveProjectPath ?? resolveProjectPath;
	const resolveFullTarget = deps.resolveFullScanTarget ?? resolveFullScanTarget;
	const materializeSourceSnapshot =
		deps.materializeScopedSourceSnapshot ?? materializeScopedSourceSnapshot;
	const runtimeIsolationConfigured =
		deps.resolveRuntimeIsolationProviderFactory !== undefined ||
		deps.runtimeIsolationProviderFactory !== undefined;
	const resolveRuntimeEnv = async () => {
		if (deps.resolveRuntimeEnv) return await deps.resolveRuntimeEnv();
		if (deps.env) return deps.env;
		throw new HttpError(500, "Scan runtime is not configured.");
	};
	const resolveRuntimeIsolationProviderFactory = (env: AppEnv) =>
		deps.resolveRuntimeIsolationProviderFactory
			? deps.resolveRuntimeIsolationProviderFactory(env)
			: (deps.runtimeIsolationProviderFactory ?? null);
	const projectPathPolicyStatus = async (projectPath: string) => {
		try {
			await resolvePath(projectPath);
			return { status: "allowed" as const, reasonCode: null };
		} catch (error) {
			const reasonCode =
				error instanceof ProjectPathPolicyError
					? error.code
					: "PROJECT_PATH_POLICY_FAILED";
			return {
				status:
					reasonCode === "PROJECT_PATH_NOT_FOUND"
						? ("missing" as const)
						: ("blocked" as const),
				reasonCode,
			};
		}
	};
	const resolveWebProjectPath = async (projectPath: string) => {
		try {
			return await resolvePath(projectPath);
		} catch (error) {
			if (!(error instanceof ProjectPathPolicyError)) throw error;
			throw new HttpError(400, error.message);
		}
	};

	const route = new Hono()
		.get("/", async (c) => {
			const authUser = getAuthContextUser(c);
			const list = await repo.listProjects(authUser.userId);
			const visibleProjects = list.filter(
				(project) => !isTemporaryProjectPath(project.repoPath),
			);
			return c.json({
				projects: await Promise.all(
					visibleProjects.map(async (project) => ({
						...project,
						pathPolicy: await projectPathPolicyStatus(project.repoPath),
					})),
				),
			});
		})
		.post("/folder-picker", requireAdmin(), async (c) => {
			getAuthContextUser(c);
			if (process.platform !== "darwin") {
				throw new HttpError(
					400,
					"Folder picker is only available on macOS in this local build.",
				);
			}

			const script =
				'POSIX path of (choose folder with prompt "Select a project folder to scan")';
			const {
				exitCode,
				stdout: stdoutText,
				stderr: stderrText,
			} = await runBoundedCliProcess({
				argv: ["osascript", "-e", script],
				processCapacity: deps.processCapacity,
				timeoutMs: FOLDER_PICKER_TIMEOUT_MS,
				outputLimitBytes: FOLDER_PICKER_OUTPUT_LIMIT_BYTES,
				label: "Folder picker",
			});

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
			if (!selectedPath) return c.json({ path: null });
			const authorized = await resolveWebProjectPath(selectedPath);
			return c.json({
				path: authorized.canonicalPath,
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
			return c.json({
				project: {
					...project,
					pathPolicy: await projectPathPolicyStatus(project.repoPath),
				},
			});
		})
		.delete(
			"/:projectId",
			zValidator("json", z.object({ confirmation: z.string().min(1) })),
			async (c) => {
				if (!deps.projectDeletionService) {
					throw new HttpError(500, "Project deletion is not configured.");
				}
				const authUser = getAuthContextUser(c);
				const result = await deps.projectDeletionService.deleteOwnedProject({
					projectId: c.req.param("projectId"),
					userId: authUser.userId,
					confirmation: c.req.valid("json").confirmation,
				});
				return c.json({
					deletedProjectId: result.deletedProjectId,
					deletedAt: result.deletedAt.toISOString(),
					artifactCleanup: result.artifactCleanup,
				});
			},
		)
		.post("/", zValidator("json", createProjectSchema), async (c) => {
			const authUser = getAuthContextUser(c);
			const body = c.req.valid("json");

			const { canonicalPath: resolvedPath } = await resolveWebProjectPath(
				body.repoPath,
			);

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

			return c.json(
				{
					project: {
						...created,
						pathPolicy: await projectPathPolicyStatus(resolvedPath),
					},
				},
				201,
			);
		});
	const scanRoutes = createProjectScanRoutes({
		deps,
		repo,
		resolveRuntimeEnv,
		runtimeIsolationConfigured,
		resolveRuntimeIsolationProviderFactory,
		resolveFullTarget,
		materializeSourceSnapshot,
		resolveWebProjectPath,
	});
	route.route("/", scanRoutes);
	return route;
}
