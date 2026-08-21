import { randomUUID } from "node:crypto";
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
import {
	ProcessCapacityExceededError,
	type WebProcessCapacity,
} from "../modules/processes/web-process-capacity";
import { analyzeProjectCapabilities } from "../modules/project-capabilities/plugin-detector";
import {
	buildDiffScanPlan,
	toDiffScanPreview,
} from "../modules/scans/diff-scan-plan";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "../modules/scans/git-diff-resolver";
import { resolveProfileSteps } from "../modules/scans/profile-runner";
import { getProfileById } from "../modules/scans/profiles";
import type { ProjectDeletionService } from "../modules/scans/project-deletion-service";
import { isTemporaryProjectPath } from "../modules/scans/project-visibility";
import type {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import {
	applyStrictProfileRequirements,
	buildScanExecutionPlan,
} from "../modules/scans/scan-execution-plan-builder";
import {
	executionConfigFromPolicy,
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
import { runScanPreflight } from "../modules/scans/scan-preflight";
import type { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";
import { normalizeToolExecutionConfig } from "../modules/scans/tools/tool-process-runner";
import {
	ProjectPathPolicyError,
	resolveProjectPath,
} from "../security/project-path-policy";
import { runBoundedCliProcess } from "./cli-process-bridge";

const FOLDER_PICKER_TIMEOUT_MS = 10 * 60 * 1_000;
const FOLDER_PICKER_OUTPUT_LIMIT_BYTES = 64 * 1_024;
const ABSOLUTE_WEB_SCAN_STEP_TIMEOUT_MAX_SEC = 86_400;

type ProjectsRouteDeps = {
	projectRepository: ProjectRepository;
	scanRepository?: ScanRepository;
	scanSupervisor?: ScanProcessSupervisor;
	processCapacity?: WebProcessCapacity;
	env?: AppEnv;
	projectDeletionService?: ProjectDeletionService;
	resolveProjectPath?: typeof resolveProjectPath;
};

export function createProjectsRoute(deps: ProjectsRouteDeps) {
	const repo = deps.projectRepository;
	const resolvePath = deps.resolveProjectPath ?? resolveProjectPath;
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
		})
		.post(
			"/:projectId/scans/preflight",
			zValidator(
				"json",
				z.object({
					profile: z.string().default("baseline"),
					stepId: z.string().optional(),
					consentProjectCodeExecution: z.boolean().default(false).optional(),
					runner: z.enum(["host", "docker"]).default("host").optional(),
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
				if (!deps.env) {
					throw new HttpError(500, "Scan runtime is not configured.");
				}
				const authorized = await resolveWebProjectPath(project.repoPath);
				const profile = getProfileById(body.profile);
				if (!profile) {
					throw new HttpError(400, `Profile not found: ${body.profile}`);
				}
				const policy = resolveScanExecutionPolicy({
					env: deps.env,
					surface: "web",
					requestedRunner: body.runner,
				});
				const execution = normalizeToolExecutionConfig(
					executionConfigFromPolicy(policy),
				);
				const steps = applyStrictProfileRequirements(
					profile,
					resolveProfileSteps({
						steps: profile.steps,
						tools: profile.tools,
						stepId: body.stepId,
					}),
				);
				const technologyAnalysis = await analyzeProjectCapabilities(
					authorized.canonicalPath,
				);
				const preflight = await runScanPreflight({
					profile,
					steps,
					projectId,
					repoPath: authorized.canonicalPath,
					execution,
					consentProjectCodeExecution:
						body.consentProjectCodeExecution === true,
				});
				const executionPlan = buildScanExecutionPlan({
					scanRunId: randomUUID(),
					projectId,
					profile,
					steps,
					preflight,
					technologyRegistryDigest:
						technologyAnalysis.capabilityPlan.registryDigest,
					runner: execution.runner,
				});
				return c.json({ preflight, executionPlan });
			},
		)
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
				const authorized = await resolveWebProjectPath(project.repoPath);
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
					const technologyAnalysis = await analyzeProjectCapabilities(
						authorized.canonicalPath,
					);
					const plan = buildDiffScanPlan({
						resolved: await resolveGitDiff({
							projectPath: authorized.canonicalPath,
							target: body.target,
							scope: profile.scope,
						}),
						tools: profile.tools,
						detectedPluginIds: technologyAnalysis.detections
							.filter((detection) => detection.detected)
							.map((detection) => detection.pluginId),
						projectInventoryPaths: technologyAnalysis.context.inventory.map(
							(entry) => entry.path,
						),
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
					expectedPreflightBindingHash: z
						.string()
						.regex(/^sha256:[0-9a-f]{64}$/)
						.optional(),
					expectedPlanHash: z
						.string()
						.regex(/^sha256:[0-9a-f]{64}$/)
						.optional(),
					continueOnToolFailure: z.boolean().default(true).optional(),
					consentProjectCodeExecution: z.boolean().default(false).optional(),
					timeoutSec: z
						.number()
						.int()
						.positive()
						.max(ABSOLUTE_WEB_SCAN_STEP_TIMEOUT_MAX_SEC)
						.optional(),
					runner: z.enum(["host", "docker"]).default("host").optional(),
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

				if (!deps.env) {
					throw new HttpError(500, "Scan runtime is not configured.");
				}
				if (
					body.timeoutSec !== undefined &&
					body.timeoutSec > deps.env.webScanStepTimeoutMaxSec
				) {
					throw new HttpError(
						400,
						`timeoutSec must be at most ${deps.env.webScanStepTimeoutMaxSec}.`,
					);
				}
				if (!deps.scanRepository || !deps.scanSupervisor) {
					throw new HttpError(500, "Scan runtime is not configured.");
				}
				await resolveWebProjectPath(project.repoPath);
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
						finalReportRequest: {
							requested: body.finalReport ?? true,
							title:
								body.reportTitle?.trim() ||
								`${body.profile} 最終セキュリティレポート`,
						},
						executionPolicy: scanExecutionPolicyMetadata(policy),
						requestedTarget: body.target,
						expectedTargetDigest: body.expectedTargetDigest ?? null,
						expectedPreflightBindingHash:
							body.expectedPreflightBindingHash ?? null,
						expectedPlanHash: body.expectedPlanHash ?? null,
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
					"--consent-project-code-execution",
					String(body.consentProjectCodeExecution === true),
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
				if (body.expectedPreflightBindingHash) {
					args.push(
						"--expected-preflight-binding-hash",
						body.expectedPreflightBindingHash,
					);
				}
				if (body.expectedPlanHash) {
					args.push("--expected-plan-hash", body.expectedPlanHash);
				}

				try {
					await deps.scanSupervisor.launch(queued.id, args);
				} catch (error) {
					if (error instanceof ProcessCapacityExceededError) {
						throw new HttpError(429, error.message);
					}
					throw error;
				}
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
