import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { dependencyResolutionSchema } from "../../shared/schemas/maven-resolution.schema";
import { scanTargetSchema } from "../../shared/schemas/scan-target.schema";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { RuntimeTargetProvider } from "../modules/dast/runtime-target-provider";
import { analyzeProjectCapabilities } from "../modules/project-capabilities/plugin-detector";
import {
	buildRuntimeIsolationPreflight,
	runtimeIsolationExecutionPlanBinding,
} from "../modules/runtime-isolation/runtime-isolation-preflight";
import { runtimeScannerImageRequirementsForSteps } from "../modules/runtime-isolation/runtime-isolation-provider-factory";
import { buildDiffScanPlan } from "../modules/scans/diff-scan-plan";
import type { FullSourceSnapshot } from "../modules/scans/execution/lifecycle/full-source-snapshot";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "../modules/scans/git-diff-resolver";
import { resolveDefaultCatalogProfileId } from "../modules/scans/profile-catalog";
import { resolveProfileSteps } from "../modules/scans/profile-runner";
import {
	applyStrictProfileRequirements,
	buildScanExecutionPlan,
} from "../modules/scans/scan-execution-plan-builder";
import {
	executionConfigFromPolicy,
	resolveScanExecutionPolicy,
} from "../modules/scans/scan-execution-policy";
import { runScanPreflight } from "../modules/scans/scan-preflight";
import { resolveScanScope } from "../modules/scans/target-scope";
import { normalizeToolExecutionConfig } from "../modules/scans/tools/tool-process-runner";
import type { ProjectScanRouteContext } from "./project-scan.route";
import { resolveWebProfileSelection } from "./project-scan-route-support";

export function createProjectScanPreflightRoute(
	context: ProjectScanRouteContext,
) {
	const {
		repo,
		resolveRuntimeEnv,
		runtimeIsolationConfigured,
		resolveRuntimeIsolationProviderFactory,
		resolveFullTarget,
		materializeSourceSnapshot,
		resolveWebProjectPath,
	} = context;
	return new Hono().post(
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
	);
}
