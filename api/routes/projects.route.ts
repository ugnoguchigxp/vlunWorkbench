import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createProjectSchema } from "../../shared/schemas/scan.schema";
import { scanTargetSchema } from "../../shared/schemas/scan-target.schema";
import type { AppEnv } from "../app/env";
import { requireAdmin } from "../middleware/auth";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import {
	buildDiffScanPlan,
	toDiffScanPreview,
} from "../modules/scans/diff-scan-plan";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "../modules/scans/git-diff-resolver";
import { getProfileById } from "../modules/scans/profiles";
import { isTemporaryProjectPath } from "../modules/scans/project-visibility";
import {
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
import type { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";
import {
	authorizeProjectPath,
	ProjectPathPolicyError,
} from "../security/project-path-policy";

type ProjectsRouteDeps = {
	projectRepository: ProjectRepository;
	scanRepository?: ScanRepository;
	scanSupervisor?: ScanProcessSupervisor;
	env?: AppEnv;
};

export function createProjectsRoute(deps: ProjectsRouteDeps) {
	const repo = deps.projectRepository;
	const projectPathPolicyStatus = async (projectPath: string) => {
		try {
			await authorizeProjectPath({
				projectPath,
				allowedRoots: deps.env?.projectAllowedRoots ?? [],
			});
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
	const authorizeWebProjectPath = async (projectPath: string) => {
		try {
			return await authorizeProjectPath({
				projectPath,
				allowedRoots: deps.env?.projectAllowedRoots ?? [],
			});
		} catch (error) {
			if (!(error instanceof ProjectPathPolicyError)) throw error;
			if (error.code === "PROJECT_PATH_NOT_ALLOWED") {
				throw new HttpError(403, error.message);
			}
			if (error.code === "PROJECT_ALLOWED_ROOT_INVALID") {
				throw new HttpError(500, error.message);
			}
			throw new HttpError(400, error.message);
		}
	};

	return new Hono()
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
			if (!selectedPath) return c.json({ path: null });
			const authorized = await authorizeWebProjectPath(selectedPath);
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
		.post("/", zValidator("json", createProjectSchema), async (c) => {
			const authUser = getAuthContextUser(c);
			const body = c.req.valid("json");

			const { canonicalPath: resolvedPath } = await authorizeWebProjectPath(
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

			return c.json({ project: created }, 201);
		})
		.post(
			"/:projectId/scans/preview",
			zValidator(
				"json",
				z.object({
					profile: z.string().default("diff-source-baseline"),
					target: scanTargetSchema,
				}),
			),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const projectId = c.req.param("projectId");
				const body = c.req.valid("json");
				const project = await repo.findById(projectId);
				if (!project) throw new HttpError(404, "Project not found");
				if (project.ownerUserId !== authUser.userId) {
					throw new HttpError(403, "Forbidden");
				}
				const authorized = await authorizeWebProjectPath(project.repoPath);
				const profile = getProfileById(body.profile);
				if (!profile) {
					throw new HttpError(400, `Profile not found: ${body.profile}`);
				}
				if (body.target.kind === "full") {
					throw new HttpError(
						400,
						"diff_target_not_supported: preview requires a non-full target.",
					);
				}
				if (
					!(profile.supportedTargets ?? ["full"]).includes(body.target.kind)
				) {
					throw new HttpError(
						400,
						`diff_target_not_supported: profile ${profile.id} does not support ${body.target.kind}.`,
					);
				}
				try {
					const plan = buildDiffScanPlan({
						resolved: await resolveGitDiff({
							projectPath: authorized.canonicalPath,
							target: body.target,
							scope: profile.scope,
						}),
						tools: profile.tools,
					});
					return c.json(toDiffScanPreview(plan));
				} catch (error) {
					if (error instanceof GitDiffResolutionError) {
						throw new HttpError(400, `${error.code}: ${error.message}`);
					}
					throw error;
				}
			},
		)
		.post(
			"/:projectId/scans",
			zValidator(
				"json",
				z.object({
					profile: z.string().default("baseline"),
					target: scanTargetSchema.default({ kind: "full" }),
					expectedTargetDigest: z
						.string()
						.regex(/^[0-9a-f]{64}$/i)
						.optional(),
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
				await authorizeWebProjectPath(project.repoPath);
				const profile = getProfileById(body.profile);
				if (!profile) {
					throw new HttpError(400, `Profile not found: ${body.profile}`);
				}
				if (
					!(profile.supportedTargets ?? ["full"]).includes(body.target.kind)
				) {
					throw new HttpError(
						400,
						`diff_target_not_supported: profile ${profile.id} does not support ${body.target.kind}.`,
					);
				}
				if (body.target.kind === "working_tree" && !body.expectedTargetDigest) {
					throw new HttpError(
						400,
						"expectedTargetDigest is required for a working_tree scan.",
					);
				}
				if (body.target.kind === "full" && body.expectedTargetDigest) {
					throw new HttpError(
						400,
						"expectedTargetDigest is not valid for a full scan.",
					);
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
						requestedTarget: body.target,
						expectedTargetDigest: body.expectedTargetDigest ?? null,
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
				appendScanTargetArgs(args, body.target);
				if (body.expectedTargetDigest) {
					args.push("--expected-target-digest", body.expectedTargetDigest);
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

function appendScanTargetArgs(
	args: string[],
	target: z.infer<typeof scanTargetSchema>,
): void {
	args.push(
		"--target",
		target.kind === "working_tree" ? "working-tree" : target.kind,
	);
	if ("base" in target && target.base) args.push("--base", target.base);
	if ("head" in target && target.head) args.push("--head", target.head);
	if (target.kind === "working_tree") {
		args.push("--include-untracked", String(target.includeUntracked));
	}
}
