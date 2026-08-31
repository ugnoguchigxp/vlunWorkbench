import { randomUUID } from "node:crypto";
import path from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { dependencyResolutionSchema } from "../../shared/schemas/maven-resolution.schema";
import { createProjectSchema } from "../../shared/schemas/scan.schema";
import { scanTargetSchema } from "../../shared/schemas/scan-target.schema";
import type { AppEnv } from "../app/env";
import { requireAdmin } from "../middleware/auth";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { RuntimeTargetProvider } from "../modules/dast/runtime-target-provider";
import {
	ProcessCapacityExceededError,
	type WebProcessCapacity,
} from "../modules/processes/web-process-capacity";
import { analyzeProjectCapabilities } from "../modules/project-capabilities/plugin-detector";
import {
	buildRuntimeIsolationPreflight,
	runtimeIsolationExecutionPlanBinding,
} from "../modules/runtime-isolation/runtime-isolation-preflight";
import {
	type RuntimeIsolationProviderFactory,
	runtimeScannerImageRequirementsForSteps,
} from "../modules/runtime-isolation/runtime-isolation-provider-factory";
import {
	buildDiffScanPlan,
	toDiffScanPreview,
} from "../modules/scans/diff-scan-plan";
import {
	type FullSourceSnapshot,
	materializeScopedSourceSnapshot,
} from "../modules/scans/execution/lifecycle/full-source-snapshot";
import type { ScanLaunchAttemptRepository } from "../modules/scans/execution/scan-launch-attempt-repository";
import { resolveFullScanTarget } from "../modules/scans/full-scan-target";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "../modules/scans/git-diff-resolver";
import { resolveDefaultCatalogProfileId } from "../modules/scans/profile-catalog";
import {
	normalizeProfileResolutionInput,
	ProfileResolutionError,
	resolveProfileSelection,
} from "../modules/scans/profile-resolution";
import { resolveProfileSteps } from "../modules/scans/profile-runner";
import type { ProjectDeletionService } from "../modules/scans/project-deletion-service";
import { isTemporaryProjectPath } from "../modules/scans/project-visibility";
import type {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import {
	applyStrictProfileRequirements,
	buildScanExecutionPlan,
	scanProfileStepId,
} from "../modules/scans/scan-execution-plan-builder";
import {
	executionConfigFromPolicy,
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
import { runScanPreflight } from "../modules/scans/scan-preflight";
import type { ScanProcessSupervisor } from "../modules/scans/scan-process-supervisor";
import { resolveScanScope } from "../modules/scans/target-scope";
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
					profile: z.string().optional(),
					target: scanTargetSchema.default({ kind: "full" }),
					resultPolicy: z.enum(["advisory", "gate"]).optional(),
					allowExperimental: z.boolean().default(false).optional(),
					stepId: z.string().optional(),
					consentProjectCodeExecution: z.boolean().default(false).optional(),
					runner: z.enum(["host", "docker"]).default("host").optional(),
					imageRef: z.string().optional(),
					imageTar: z.string().optional(),
					attestationSubject: z.string().min(1).max(500).optional(),
					attestationBundle: z.string().min(1).max(500).optional(),
					trustPolicy: z.string().min(1).max(500).optional(),
					slsaProvenance: z.string().min(1).max(500).optional(),
					slsaPolicy: z.string().min(1).max(500).optional(),
					authContextId: z.string().uuid().optional(),
					identityRole: z.string().min(1).max(100).optional(),
					dependencyResolution: dependencyResolutionSchema.optional().default({
						mode: "offline",
					}),
				}),
			),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const projectId = c.req.param("projectId");
				const body = c.req.valid("json");
				if (Boolean(body.authContextId) !== Boolean(body.identityRole))
					throw new HttpError(
						400,
						"authContextId and identityRole must be provided together.",
					);
				if (body.authContextId && body.profile !== "api-readonly")
					throw new HttpError(
						400,
						"authContextId is supported only by api-readonly.",
					);
				const project = await repo.findById(projectId);
				if (!project) throw new HttpError(404, "Project not found");
				if (project.ownerUserId !== authUser.userId) {
					throw new HttpError(403, "Forbidden");
				}
				const runtimeEnv = await resolveRuntimeEnv();
				const authorized = await resolveWebProjectPath(project.repoPath);
				const selectedProfileId =
					body.profile ?? resolveDefaultCatalogProfileId(body.target.kind);
				const selection = resolveWebProfileSelection({
					profileId: selectedProfileId,
					target: body.target,
					resultPolicy: body.resultPolicy,
					allowExperimental: body.allowExperimental,
					consentProjectCodeExecution: body.consentProjectCodeExecution,
					imageRef: body.imageRef,
					imageTar: body.imageTar,
					attestationSubject: body.attestationSubject,
					attestationBundle: body.attestationBundle,
					trustPolicy: body.trustPolicy,
					slsaProvenance: body.slsaProvenance,
					slsaPolicy: body.slsaPolicy,
					authContextId: body.authContextId,
				});
				const profile = selection.executionProfile;
				const policy = resolveScanExecutionPolicy({
					env: runtimeEnv,
					surface: "web",
					requestedRunner: body.runner,
					allowSlsaTrustRootNetwork: Boolean(body.slsaProvenance),
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
				const fullTargetPromise =
					body.target.kind === "full"
						? resolveFullTarget(authorized.canonicalPath, profile.scope).catch(
								(error) => {
									if (
										error instanceof GitDiffResolutionError &&
										error.code === "not_a_git_repository"
									) {
										return null;
									}
									throw error;
								},
							)
						: Promise.resolve(null);
				const resolvedDiffPromise =
					body.target.kind === "full"
						? Promise.resolve(null)
						: resolveGitDiff({
								projectPath: authorized.canonicalPath,
								target: body.target,
								scope: profile.scope,
							});
				const [technologyAnalysis, fullTarget, resolvedScope, resolvedDiff] =
					await Promise.all([
						analyzeProjectCapabilities(authorized.canonicalPath),
						fullTargetPromise,
						resolveScanScope({
							repoPath: authorized.canonicalPath,
							scope: profile.scope,
						}),
						resolvedDiffPromise,
					]);
				const diffPlan = resolvedDiff
					? buildDiffScanPlan({
							resolved: resolvedDiff,
							tools: steps.flatMap((candidate) =>
								candidate.kind === "static_tool" ? [candidate] : [],
							),
							detectedPluginIds: technologyAnalysis.detections
								.filter((detection) => detection.detected)
								.map((detection) => detection.pluginId),
							projectInventoryPaths: technologyAnalysis.context.inventory.map(
								(entry) => entry.path,
							),
						})
					: null;
				const previewScanRunId = randomUUID();
				const runtimeIsolationProviderFactory =
					resolveRuntimeIsolationProviderFactory(runtimeEnv);
				const needsIsolatedRuntime = steps.some(
					(step) =>
						step.kind === "runtime_scanner" ||
						step.kind === "api_schema_scan" ||
						step.kind === "dast",
				);
				let sourceSnapshot: FullSourceSnapshot | null = null;
				let runtimeTargetProvider: RuntimeTargetProvider | null = null;
				try {
					if (
						needsIsolatedRuntime &&
						fullTarget &&
						runtimeIsolationProviderFactory
					) {
						sourceSnapshot = await materializeSourceSnapshot({
							repositoryPath: authorized.canonicalPath,
							sourceRevision: fullTarget.sourceRevision,
							scope: resolvedScope.scope,
						});
						if (
							fullTarget.scopeContentDigest &&
							sourceSnapshot.snapshotDigest !== fullTarget.scopeContentDigest
						) {
							throw new HttpError(
								409,
								"target_changed: scoped target changed during preview",
							);
						}
						runtimeTargetProvider = await runtimeIsolationProviderFactory({
							scanRunId: previewScanRunId,
							profileId: profile.id,
							sourceSnapshot,
							scannerImageRequirements:
								runtimeScannerImageRequirementsForSteps(steps),
						});
					}
					const basePreflight = await runScanPreflight({
						profile,
						steps,
						projectId,
						repoPath: authorized.canonicalPath,
						execution,
						mode: profile.strictness === "strict" ? "enforced" : undefined,
						consentProjectCodeExecution:
							body.consentProjectCodeExecution === true,
						allowDirtySource: body.target.kind === "working_tree",
						imageRef: body.imageRef,
						imageTar: body.imageTar,
						attestationSubject: body.attestationSubject,
						attestationBundle: body.attestationBundle,
						trustPolicy: body.trustPolicy,
						slsaProvenance: body.slsaProvenance,
						slsaPolicy: body.slsaPolicy,
						authContextId: body.authContextId,
						identityRole: body.identityRole,
						dependencyResolutionMode: body.dependencyResolution.mode,
						mavenResolverImage: runtimeEnv.mavenResolverImage,
						mavenResolutionConfig: project.metadata?.mavenResolutionConfig,
						mavenProjectDetected:
							technologyAnalysis.capabilityPlan.activePluginIds.includes(
								"build.maven",
							),
						mavenResolutionApplicable:
							diffPlan?.tools.find((tool) => tool.toolId === "osv")
								?.applicability !== "not_applicable",
						staticScannerPaths:
							diffPlan?.scanPaths ??
							technologyAnalysis.context.inventory.map((entry) => entry.path),
						targetPlan: runtimeTargetProvider?.plan,
						runtimeDockerImages: runtimeTargetProvider?.preflightDockerImages,
						runtimeScannerImages: runtimeTargetProvider?.runtimeScannerImages,
						isolatedRuntimeProviderAvailable:
							runtimeIsolationConfigured === false
								? undefined
								: Boolean(runtimeTargetProvider),
					});
					const runtimeIsolationPlanning =
						runtimeTargetProvider?.runtimeIsolationPlanning;
					const preflight = runtimeIsolationPlanning
						? buildRuntimeIsolationPreflight({
								base: basePreflight,
								planning: runtimeIsolationPlanning,
								networkReady: true,
								cleanupReady: true,
							})
						: basePreflight;
					const runtimeIsolation = runtimeIsolationExecutionPlanBinding(
						runtimeIsolationPlanning,
					);
					const executionPlan = buildScanExecutionPlan({
						scanRunId: previewScanRunId,
						projectId,
						profile,
						steps,
						preflight,
						technologyRegistryDigest:
							technologyAnalysis.capabilityPlan.registryDigest,
						sourceSnapshotDigest: fullTarget?.digest,
						runner: execution.runner,
						schemaVersion: runtimeIsolation
							? 3
							: runtimeEnv.scanExecutionPlanV2
								? 2
								: 1,
						runtimeIsolation,
					});
					return c.json({
						preflight,
						executionPlan,
						profileResolution: selection.resolution,
					});
				} finally {
					try {
						await runtimeTargetProvider?.dispose?.();
					} finally {
						await sourceSnapshot?.cleanup();
					}
				}
			},
		)
		.post(
			"/:projectId/scans/preview",
			zValidator(
				"json",
				z.object({
					profile: z.string().optional(),
					target: scanTargetSchema,
					resultPolicy: z.enum(["advisory", "gate"]).optional(),
					allowExperimental: z.boolean().default(false).optional(),
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
				const selectedProfileId =
					body.profile ?? resolveDefaultCatalogProfileId(body.target.kind);
				const selection = resolveWebProfileSelection({
					profileId: selectedProfileId,
					target: body.target,
					resultPolicy: body.resultPolicy,
					allowExperimental: body.allowExperimental,
				});
				const profile = selection.executionProfile;
				if (body.target.kind === "full") {
					throw new HttpError(
						400,
						"diff_target_not_supported: preview requires a non-full target.",
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
					return c.json({
						...toDiffScanPreview(plan),
						profileResolution: selection.resolution,
					});
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
					profile: z.string().optional(),
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
					expectedCatalogEntryHash: z
						.string()
						.regex(/^sha256:[0-9a-f]{64}$/)
						.optional(),
					resultPolicy: z.enum(["advisory", "gate"]).optional(),
					allowExperimental: z.boolean().default(false).optional(),
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
					attestationSubject: z.string().min(1).max(500).optional(),
					attestationBundle: z.string().min(1).max(500).optional(),
					trustPolicy: z.string().min(1).max(500).optional(),
					slsaProvenance: z.string().min(1).max(500).optional(),
					slsaPolicy: z.string().min(1).max(500).optional(),
					authContextId: z.string().uuid().optional(),
					identityRole: z.string().min(1).max(100).optional(),
					dependencyResolution: dependencyResolutionSchema.optional().default({
						mode: "offline",
					}),
					finalReport: z.boolean().default(true).optional(),
					reportTitle: z.string().optional(),
				}),
			),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const projectId = c.req.param("projectId");
				const body = c.req.valid("json");
				if (Boolean(body.authContextId) !== Boolean(body.identityRole))
					throw new HttpError(
						400,
						"authContextId and identityRole must be provided together.",
					);
				if (body.authContextId && body.profile !== "api-readonly")
					throw new HttpError(
						400,
						"authContextId is supported only by api-readonly.",
					);

				const project = await repo.findById(projectId);
				if (!project) {
					throw new HttpError(404, "Project not found");
				}
				if (project.ownerUserId !== authUser.userId) {
					throw new HttpError(403, "Forbidden");
				}

				const runtimeEnv = await resolveRuntimeEnv();
				if (
					body.timeoutSec !== undefined &&
					body.timeoutSec > runtimeEnv.webScanStepTimeoutMaxSec
				) {
					throw new HttpError(
						400,
						`timeoutSec must be at most ${runtimeEnv.webScanStepTimeoutMaxSec}.`,
					);
				}
				if (!deps.scanRepository || !deps.scanSupervisor) {
					throw new HttpError(500, "Scan runtime is not configured.");
				}
				await resolveWebProjectPath(project.repoPath);
				const selectedProfileId =
					body.profile ?? resolveDefaultCatalogProfileId(body.target.kind);
				const selection = resolveWebProfileSelection({
					profileId: selectedProfileId,
					target: body.target,
					resultPolicy: body.resultPolicy,
					allowExperimental: body.allowExperimental,
					imageRef: body.imageRef,
					imageTar: body.imageTar,
					attestationSubject: body.attestationSubject,
					attestationBundle: body.attestationBundle,
					trustPolicy: body.trustPolicy,
					slsaProvenance: body.slsaProvenance,
					slsaPolicy: body.slsaPolicy,
					authContextId: body.authContextId,
					consentProjectCodeExecution: body.consentProjectCodeExecution,
				});
				const launchAttempt = deps.scanLaunchAttemptRepository
					? await deps.scanLaunchAttemptRepository.create({
							projectId,
							requestedProfileId: selectedProfileId,
							createdByUserId: authUser.userId,
							profileVariantId: selection.resolution.executionVariantId,
							catalogEntryHash: selection.resolution.catalogEntryHash,
							sanitizedInputSummary: {
								targetKind: body.target.kind,
								hasImageRef: Boolean(body.imageRef),
								hasImageTar: Boolean(body.imageTar),
								hasAttestation: Boolean(
									body.attestationSubject &&
										body.attestationBundle &&
										body.trustPolicy,
								),
								hasSlsaProvenance: Boolean(
									body.attestationSubject &&
										body.slsaProvenance &&
										body.slsaPolicy,
								),
								dependencyResolutionMode: body.dependencyResolution.mode,
							},
						})
					: null;
				if (
					body.expectedCatalogEntryHash &&
					body.expectedCatalogEntryHash !==
						selection.resolution.catalogEntryHash
				) {
					if (launchAttempt) {
						await deps.scanLaunchAttemptRepository?.reject({
							attemptId: launchAttempt.id,
							readinessStatus: null,
							reasonCodes: ["binding_changed"],
						});
					}
					throw new HttpError(
						409,
						"catalog_entry_changed: profile catalog entry changed after preview",
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
					env: runtimeEnv,
					surface: "web",
					requestedRunner: body.runner,
					allowSlsaTrustRootNetwork: Boolean(body.slsaProvenance),
				});
				const queued = await deps.scanRepository.createScanRun({
					projectId,
					profile: selectedProfileId,
					status: "queued",
					createdByUserId: authUser.userId,
					metadata: {
						launchSource: "web",
						profileResolution: selection.resolution,
						finalReportRequest: {
							requested: body.finalReport ?? true,
							title:
								body.reportTitle?.trim() ||
								`${selectedProfileId} 最終セキュリティレポート`,
						},
						executionPolicy: scanExecutionPolicyMetadata(policy),
						requestedTarget: body.target,
						// The runner creates the immutable execution plan after it has
						// resolved the snapshot and runtime. Keep this non-authoritative
						// display inventory at admission so the UI never has a 0/0 gap
						// while that work is underway.
						queuedProgressSteps: resolveProfileSteps({
							steps: selection.executionProfile.steps,
							tools: selection.executionProfile.tools,
						}).map((step) => ({
							stepId: scanProfileStepId(step),
							kind: step.kind,
							adapter:
								step.kind === "static_tool"
									? step.toolId
									: step.kind === "dast"
										? step.profileId
										: step.adapter,
							displayName: step.displayName,
							required: step.required,
						})),
						expectedTargetDigest: body.expectedTargetDigest ?? null,
						expectedPreflightBindingHash:
							body.expectedPreflightBindingHash ?? null,
						expectedPlanHash: body.expectedPlanHash ?? null,
						expectedCatalogEntryHash:
							body.expectedCatalogEntryHash ??
							selection.resolution.catalogEntryHash,
					},
				});
				await deps.scanRepository.createScanEvent({
					scanRunId: queued.id,
					level: "info",
					eventType: "scan.queued",
					message: `Scan profile ${selectedProfileId} queued.`,
					data: { executionPolicy: scanExecutionPolicyMetadata(policy) },
				});
				await deps.scanRepository.createScanEvent({
					scanRunId: queued.id,
					level: "info",
					eventType: "scan.preflight.started",
					message: "Preparing the target and verifying scan dependencies.",
					data: { phase: "resource_preparation" },
				});
				const args = [
					// Managed workers must inherit the server's configuration snapshot.
					"bun",
					"--no-env-file",
					"run",
					"api/cli/scan-profile.ts",
					"--scan-run-id",
					queued.id,
					"--execution-surface",
					"web",
					"--project-id",
					projectId,
					"--profile",
					selectedProfileId,
					"--continue-on-tool-failure",
					String(body.continueOnToolFailure ?? true),
					"--consent-project-code-execution",
					String(body.consentProjectCodeExecution === true),
					"--runner",
					policy.runner,
					"--final-report",
					String(body.finalReport ?? true),
					"--dependency-resolution",
					body.dependencyResolution.mode,
				];
				if (body.resultPolicy) args.push("--result-policy", body.resultPolicy);
				if (body.allowExperimental) args.push("--allow-experimental", "true");

				if (body.timeoutSec !== undefined) {
					args.push("--timeout-sec", String(body.timeoutSec));
				}
				if (body.imageRef) args.push("--image-ref", body.imageRef);
				if (body.imageTar) args.push("--image-tar", body.imageTar);
				if (body.attestationSubject) {
					args.push("--attestation-subject", body.attestationSubject);
				}
				if (body.attestationBundle) {
					args.push("--attestation-bundle", body.attestationBundle);
				}
				if (body.trustPolicy) args.push("--trust-policy", body.trustPolicy);
				if (body.slsaProvenance) {
					args.push("--slsa-provenance", body.slsaProvenance);
				}
				if (body.slsaPolicy) args.push("--slsa-policy", body.slsaPolicy);
				if (policy.networkMode === "default") args.push("--network", "default");
				if (body.authContextId && body.identityRole) {
					args.push("--auth-context-id", body.authContextId);
					args.push("--identity-role", body.identityRole);
				}
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
				args.push(
					"--expected-catalog-entry-hash",
					body.expectedCatalogEntryHash ??
						selection.resolution.catalogEntryHash,
				);

				try {
					await deps.scanSupervisor.launch(queued.id, args);
				} catch (error) {
					const reasonCode =
						error instanceof ProcessCapacityExceededError
							? "runtime_capacity_exhausted"
							: "driver_start_failed";
					if (typeof deps.scanRepository.updateScanRunStatus === "function") {
						await deps.scanRepository.updateScanRunStatus(queued.id, "failed", {
							profileOutcome: "failed",
							summary: reasonCode,
						});
						await deps.scanRepository.createScanEvent({
							scanRunId: queued.id,
							level: "error",
							eventType: "scan.failed",
							message: `Scan launch failed: ${reasonCode}.`,
							data: { reasonCode },
						});
					}
					if (launchAttempt) {
						await deps.scanLaunchAttemptRepository?.reject({
							attemptId: launchAttempt.id,
							readinessStatus: null,
							reasonCodes: [reasonCode],
						});
					}
					if (error instanceof ProcessCapacityExceededError) {
						throw new HttpError(429, error.message);
					}
					throw error;
				}
				if (launchAttempt) {
					await deps.scanLaunchAttemptRepository?.admit({
						attemptId: launchAttempt.id,
						scanRunId: queued.id,
					});
				}
				return c.json(
					{
						scan: {
							id: queued.id,
							status: "queued",
							profile: selectedProfileId,
						},
						profileResolution: selection.resolution,
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

function resolveWebProfileSelection(params: {
	profileId: string;
	target: z.infer<typeof scanTargetSchema>;
	resultPolicy?: "advisory" | "gate";
	allowExperimental?: boolean;
	imageRef?: string;
	imageTar?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
	slsaProvenance?: string;
	slsaPolicy?: string;
	authContextId?: string;
	consentProjectCodeExecution?: boolean;
}) {
	try {
		return resolveProfileSelection({
			requestedProfileId: params.profileId,
			surface: "web",
			target: params.target,
			providedInputKinds: normalizeProfileResolutionInput({
				repoPath: "web-project",
				imageRef: params.imageRef,
				imageTar: params.imageTar,
				attestationSubject: params.attestationSubject,
				attestationBundle: params.attestationBundle,
				trustPolicy: params.trustPolicy,
				slsaProvenance: params.slsaProvenance,
				slsaPolicy: params.slsaPolicy,
				authContextRef: params.authContextId,
				executionConsent: params.consentProjectCodeExecution,
			}),
			requestedResultPolicy: params.resultPolicy,
			allowExperimental: params.allowExperimental,
		});
	} catch (error) {
		if (error instanceof ProfileResolutionError) {
			throw new HttpError(400, `${error.code}: ${error.message}`);
		}
		throw error;
	}
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
