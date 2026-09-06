import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { dependencyResolutionSchema } from "../../shared/schemas/maven-resolution.schema";
import { scanTargetSchema } from "../../shared/schemas/scan-target.schema";
import type { AppEnv } from "../app/env";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { ProcessCapacityExceededError } from "../modules/processes/web-process-capacity";
import { analyzeProjectCapabilities } from "../modules/project-capabilities/plugin-detector";
import type { RuntimeIsolationProviderFactory } from "../modules/runtime-isolation/runtime-isolation-provider-factory";
import {
	buildDiffScanPlan,
	toDiffScanPreview,
} from "../modules/scans/diff-scan-plan";
import type { materializeScopedSourceSnapshot } from "../modules/scans/execution/lifecycle/full-source-snapshot";
import type { resolveFullScanTarget } from "../modules/scans/full-scan-target";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "../modules/scans/git-diff-resolver";
import { resolveDefaultCatalogProfileId } from "../modules/scans/profile-catalog";
import { resolveProfileSteps } from "../modules/scans/profile-runner";
import type { ProjectRepository } from "../modules/scans/repositories";
import { scanProfileStepId } from "../modules/scans/scan-execution-plan-builder";
import {
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
import { createProjectScanPreflightRoute } from "./project-scan-preflight.route";
import {
	appendScanTargetArgs,
	resolveWebProfileSelection,
} from "./project-scan-route-support";
import type { ProjectsRouteDeps } from "./projects.route";

const ABSOLUTE_WEB_SCAN_STEP_TIMEOUT_MAX_SEC = 86_400;

export type ProjectScanRouteContext = {
	deps: ProjectsRouteDeps;
	repo: ProjectRepository;
	resolveRuntimeEnv: () => Promise<AppEnv>;
	runtimeIsolationConfigured: boolean;
	resolveRuntimeIsolationProviderFactory: (
		env: AppEnv,
	) => RuntimeIsolationProviderFactory | null;
	resolveFullTarget: typeof resolveFullScanTarget;
	materializeSourceSnapshot: typeof materializeScopedSourceSnapshot;
	resolveWebProjectPath: (
		projectPath: string,
	) => Promise<{ canonicalPath: string }>;
};

export function createProjectScanRoutes(context: ProjectScanRouteContext) {
	const { deps, repo, resolveRuntimeEnv, resolveWebProjectPath } = context;
	return new Hono()
		.route("/", createProjectScanPreflightRoute(context))
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
