import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { ScanProfile } from "../../shared/schemas/scan-profile.schema";
import type { ScanTarget } from "../../shared/schemas/scan-target.schema";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { DastAuthContextCrypto } from "../modules/dast/auth-context-crypto";
import { DastAuthContextRepository } from "../modules/dast/auth-context-repository";
import { resolveWorkspaceTargetGrantPath } from "../modules/integrations/nightworkers/nightworkers-workspace-target-grant-cli";
import { analyzeProjectCapabilities } from "../modules/project-capabilities/plugin-detector";
import {
	loadRuntimeIsolationProviderFactory,
	runtimeIsolationSettingsFromAppEnv,
} from "../modules/runtime-isolation/runtime-isolation-runtime-config";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import {
	buildDiffScanPlan,
	toDiffScanPreview,
} from "../modules/scans/diff-scan-plan";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "../modules/scans/git-diff-resolver";
import type { resolveProfileSelection } from "../modules/scans/profile-resolution";
import {
	resolveProfileSteps,
	runProfileScan,
} from "../modules/scans/profile-runner";
import {
	ProjectResolutionError,
	resolveProjectByPath,
} from "../modules/scans/project-resolver";
import { ProjectRepository } from "../modules/scans/repositories";
import {
	applyStrictProfileRequirements,
	buildScanExecutionPlan,
} from "../modules/scans/scan-execution-plan-builder";
import {
	executionConfigFromPolicy,
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
import { finalizeScanAfterDiagnostic } from "../modules/scans/scan-finalization-service";
import { runScanPreflight } from "../modules/scans/scan-preflight";
import {
	normalizeToolExecutionConfig,
	type DockerNetworkMode,
	type ToolRunnerKind,
} from "../modules/scans/tools/tool-process-runner";
import { SettingsRepository } from "../modules/settings/settings.repository";
import { ProjectPathPolicyError } from "../security/project-path-policy";
import { runCliAutomatedDiagnostic } from "./scan-profile-diagnostic";
import { buildScanProfileDryRun } from "./scan-profile-dry-run";
import { scanProfileExitCode } from "./scan-profile-exit-code";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

export type ScanProfileExecutionContext = {
	projectId?: string;
	scanRunId?: string;
	executionSurface: "cli" | "web";
	projectPath?: string;
	workspaceTargetGrantRef?: string;
	createProject: boolean;
	scanTarget: ScanTarget;
	profileId: string;
	expectedTargetDigest?: string;
	expectedPreflightBindingHash?: string;
	expectedPlanHash?: string;
	expectedCatalogEntryHash?: string;
	resultPolicy?: "advisory" | "gate";
	allowExperimental: boolean;
	preview: boolean;
	stepId?: string;
	timeoutSec?: number;
	continueOnToolFailure: boolean;
	consentProjectCodeExecution: boolean;
	outputSummaryPath?: string;
	dryRun: boolean;
	finalReportEnabled: boolean;
	automatedDiagnosticEnabled: boolean;
	reportTitle?: string;
	reportOutputPath?: string;
	imageRef?: string;
	imageTar?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
	slsaProvenance?: string;
	slsaPolicy?: string;
	authContextId?: string;
	identityRole?: string;
	dependencyResolutionMode: "offline" | "registry";
	runner?: ToolRunnerKind;
	networkMode: DockerNetworkMode;
	profile: ScanProfile;
	profileResolution: ReturnType<typeof resolveProfileSelection>["resolution"];
	dockerBin?: string;
	dockerImage?: string;
	dockerMemory?: string;
	dockerCpus?: string;
	toolCacheDir?: string;
};

export async function executeResolvedScanProfile(
	params: ScanProfileExecutionContext,
): Promise<void> {
	const {
		projectId,
		scanRunId,
		executionSurface,
		projectPath,
		workspaceTargetGrantRef,
		createProject,
		scanTarget,
		profileId,
		expectedTargetDigest,
		expectedPreflightBindingHash,
		expectedPlanHash,
		expectedCatalogEntryHash,
		resultPolicy,
		allowExperimental,
		preview,
		stepId,
		timeoutSec,
		continueOnToolFailure,
		consentProjectCodeExecution,
		outputSummaryPath,
		dryRun,
		finalReportEnabled,
		automatedDiagnosticEnabled,
		reportTitle,
		reportOutputPath,
		imageRef,
		imageTar,
		attestationSubject,
		attestationBundle,
		trustPolicy,
		slsaProvenance,
		slsaPolicy,
		authContextId,
		identityRole,
		dependencyResolutionMode,
		runner,
		networkMode,
		profile,
		profileResolution,
		dockerBin,
		dockerImage,
		dockerMemory,
		dockerCpus,
		toolCacheDir,
	} = params;
	let dbConnection: ReturnType<typeof createDbConnection> | null = null;
	let startupComplete = false;

	try {
		const startupEnv = readAppEnv();
		dbConnection = createDbConnection(startupEnv.databaseUrl);
		const env = await new SettingsRepository(dbConnection.db).resolveAppEnv(
			startupEnv,
		);
		const authContextRepository = authContextId
			? (() => {
					if (!env.dastAuthEncryptionKey)
						throw new Error("dast_auth_encryption_key_required");
					return new DastAuthContextRepository(
						dbConnection?.db as NonNullable<typeof dbConnection>["db"],
						new DastAuthContextCrypto(
							env.dastAuthEncryptionKey,
							env.dastAuthPreviousEncryptionKeys,
						),
					);
				})()
			: undefined;
		const executionPolicy = resolveScanExecutionPolicy({
			env,
			surface: executionSurface,
			requestedRunner: runner,
		});
		const execution = normalizeToolExecutionConfig({
			...executionConfigFromPolicy(executionPolicy),
			docker:
				executionPolicy.runner === "docker"
					? {
							...executionConfigFromPolicy(executionPolicy).docker,
							dockerBin: dockerBin,
							image:
								dockerImage ??
								executionConfigFromPolicy(executionPolicy).docker?.image,
							networkMode,
							memory:
								dockerMemory ??
								executionConfigFromPolicy(executionPolicy).docker?.memory,
							cpus:
								dockerCpus ??
								executionConfigFromPolicy(executionPolicy).docker?.cpus,
							toolCacheDir: toolCacheDir,
						}
					: undefined,
		});
		startupComplete = true;
		const projectRepo = new ProjectRepository(dbConnection.db);
		const projectResolution = projectPath
			? await resolveProjectByPath(dbConnection.db, projectPath, {
					createProject,
				})
			: null;
		const project = projectResolution
			? projectResolution.project
			: projectId
				? await projectRepo.findById(projectId)
				: null;
		if (!project) {
			writeResult({
				ok: false,
				status: "config_error",
				message: `Project not found with id: ${projectId}`,
				error: {
					code: "PROJECT_NOT_FOUND",
					message: `Project not found with id: ${projectId}`,
				},
			});
			process.exitCode = 2;
			return;
		}
		let effectiveRepoPath = projectResolution?.repoPath ?? project.repoPath;
		if (workspaceTargetGrantRef) {
			effectiveRepoPath = await resolveWorkspaceTargetGrantPath({
				db: dbConnection.db,
				grantRef: workspaceTargetGrantRef,
				projectId: project.id,
				scanRunId,
				executionSurface,
				target: scanTarget,
				expectedTargetDigest,
			});
		}
		if (dryRun) {
			const steps = applyStrictProfileRequirements(
				profile,
				resolveProfileSteps({
					steps: profile.steps,
					tools: profile.tools,
					stepId,
				}),
			);
			const technologyAnalysis =
				await analyzeProjectCapabilities(effectiveRepoPath);
			const dryRunDiffPlan =
				scanTarget.kind === "full"
					? null
					: buildDiffScanPlan({
							resolved: await resolveGitDiff({
								projectPath: effectiveRepoPath,
								target: scanTarget,
								scope: profile.scope,
							}),
							tools: steps.flatMap((candidate) =>
								candidate.kind === "static_tool" ? [candidate] : [],
							),
							detectedPluginIds: technologyAnalysis.detections
								.filter((detection) => detection.detected)
								.map((detection) => detection.pluginId),
							projectInventoryPaths: technologyAnalysis.context.inventory.map(
								(entry) => entry.path,
							),
						});
			const preflight = await runScanPreflight({
				profile,
				steps,
				projectId: project.id,
				repoPath: effectiveRepoPath,
				execution,
				consentProjectCodeExecution,
				allowDirtySource: scanTarget.kind === "working_tree",
				imageRef,
				imageTar,
				attestationSubject,
				attestationBundle,
				trustPolicy,
				slsaProvenance,
				slsaPolicy,
				authContextId,
				identityRole,
				dependencyResolutionMode,
				mavenResolverImage: env.mavenResolverImage,
				mavenResolutionConfig: project.metadata?.mavenResolutionConfig,
				mavenProjectDetected:
					technologyAnalysis.capabilityPlan.activePluginIds.includes(
						"build.maven",
					),
				mavenResolutionApplicable:
					dryRunDiffPlan?.tools.find((tool) => tool.toolId === "osv")
						?.applicability !== "not_applicable",
				staticScannerPaths:
					dryRunDiffPlan?.scanPaths ??
					technologyAnalysis.context.inventory.map((entry) => entry.path),
			});
			const executionPlan = buildScanExecutionPlan({
				scanRunId: randomUUID(),
				projectId: project.id,
				profile,
				steps,
				preflight,
				technologyRegistryDigest:
					technologyAnalysis.capabilityPlan.registryDigest,
				runner: execution.runner,
				schemaVersion: env.scanExecutionPlanV2 ? 2 : 1,
			});
			const dryRunResult = buildScanProfileDryRun({
				profile,
				scanTarget,
				stepId,
				timeoutSec,
				runner: execution.runner,
				finalReportEnabled,
				automatedDiagnosticEnabled,
				imageRef,
				imageTar,
				preflight,
				expectedPreflightBindingHash,
				expectedPlanHash,
				expectedCatalogEntryHash,
				profileResolution: profileResolution,
				executionPlan,
			});
			writeResult(dryRunResult);
			process.exitCode = dryRunResult.ok === false ? 1 : 0;
			return;
		}
		if (preview) {
			if (scanTarget.kind === "full") {
				writeResult({
					ok: false,
					status: "config_error",
					message: "--preview requires a non-full --target.",
				});
				process.exitCode = 2;
				return;
			}
			if (!(profile.supportedTargets ?? ["full"]).includes(scanTarget.kind)) {
				writeResult({
					ok: false,
					status: "config_error",
					message: `diff_target_not_supported: profile ${profile.id} does not support ${scanTarget.kind}.`,
				});
				process.exitCode = 2;
				return;
			}
			const technologyAnalysis =
				await analyzeProjectCapabilities(effectiveRepoPath);
			const plan = buildDiffScanPlan({
				resolved: await resolveGitDiff({
					projectPath: effectiveRepoPath,
					target: scanTarget,
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
			writeResult({
				ok: true,
				preview: true,
				profileId,
				...toDiffScanPreview(plan),
			});
			return;
		}

		const result = await runProfileScan({
			db: dbConnection.db,
			scanRunId,
			projectId: project.id,
			profileId,
			stepId,
			repoPath: effectiveRepoPath,
			continueOnToolFailure,
			timeoutSec,
			execution,
			executionPolicyMetadata: scanExecutionPolicyMetadata(executionPolicy),
			imageRef,
			imageTar,
			attestationSubject,
			attestationBundle,
			trustPolicy,
			slsaProvenance,
			slsaPolicy,
			authContextRepository,
			authContextId,
			identityRole,
			dependencyResolutionMode,
			mavenResolverImage: env.mavenResolverImage,
			mavenResolutionConfig: project.metadata?.mavenResolutionConfig,
			executionSurface,
			target: scanTarget,
			expectedTargetDigest,
			expectedPreflightBindingHash,
			expectedPlanHash,
			expectedCatalogEntryHash,
			resultPolicy,
			allowExperimental,
			consentProjectCodeExecution,
			runtimeTargetProviderFactory:
				loadRuntimeIsolationProviderFactory({
					db: dbConnection.db,
					settings: runtimeIsolationSettingsFromAppEnv(env),
				}) ?? undefined,
			executionPlanSchemaVersion: env.scanExecutionPlanV2 ? 2 : 1,
		});
		const automatedDiagnostic =
			(automatedDiagnosticEnabled || finalReportEnabled) &&
			executionSurface === "cli" &&
			result.status === "completed"
				? await runCliAutomatedDiagnostic({
						db: dbConnection.db,
						env,
						scanRunId: result.scanRunId,
					})
				: null;
		const finalReport =
			finalReportEnabled &&
			result.status === "completed" &&
			executionSurface === "cli"
				? await finalizeScanAfterDiagnostic({
						db: dbConnection.db,
						scanRunId: result.scanRunId,
						options: {
							enabled: true,
							title:
								reportTitle ?? `${result.profileId} 最終セキュリティレポート`,
							includeFalsePositives: true,
							includeDeferred: true,
							includeUndecided: true,
						},
					})
				: undefined;
		const reportArtifactPath =
			finalReport?.artifactPath ??
			automatedDiagnostic?.reportArtifactPath ??
			null;
		if (reportOutputPath && reportArtifactPath) {
			const reportMarkdown = await new ArtifactStorage().readTextArtifact(
				reportArtifactPath,
			);
			await fs.writeFile(reportOutputPath, reportMarkdown, "utf8");
		}

		const outputPayload = {
			ok: result.ok,
			project: {
				id: project.id,
				repoPath: projectResolution?.repoPath ?? project.repoPath,
				created: projectResolution?.created ?? false,
			},
			scanRunId: result.scanRunId,
			profileId: result.profileId,
			canonicalProfileId: result.canonicalProfileId,
			executionProfileId: result.executionProfileId,
			resultPolicy: result.resultPolicy,
			gateDecision: result.gateDecision,
			runner: result.runner,
			status: result.status,
			profileOutcome: result.profileOutcome,
			message: result.message,
			finalReport,
			automatedDiagnostic,
			toolResults: result.toolResults.map((r) => ({
				toolId: r.toolId,
				toolRunId: r.toolRunId,
				status: r.status,
				exitCode: r.exitCode,
				findingCount: r.findingCount,
				error: r.error,
			})),
			stepResults: result.stepResults,
		};

		if (outputSummaryPath) {
			await fs.writeFile(
				outputSummaryPath,
				JSON.stringify(outputPayload, null, 2),
				"utf8",
			);
		}

		writeResult(outputPayload);

		const exitCode = scanProfileExitCode({
			executionSurface,
			ok: result.ok,
			resultPolicy: result.resultPolicy,
			gateDecision: result.gateDecision,
		});
		if (exitCode !== 0) {
			process.exitCode = exitCode;
			return;
		}
	} catch (err) {
		if (
			err instanceof ProjectResolutionError ||
			err instanceof ProjectPathPolicyError ||
			err instanceof GitDiffResolutionError ||
			!startupComplete
		) {
			const message = err instanceof Error ? err.message : String(err);
			writeResult({
				ok: false,
				status: "config_error",
				message,
				error: {
					code:
						err instanceof ProjectResolutionError
							? err.code
							: err instanceof ProjectPathPolicyError
								? err.code
								: err instanceof GitDiffResolutionError
									? err.code
									: "APP_CONFIG_ERROR",
					message,
				},
			});
			process.exitCode = 2;
			return;
		}
		writeResult({
			ok: false,
			runner: runner ?? "host",
			status: "failed",
			message: err instanceof Error ? err.message : String(err),
			toolResults: [],
		});
		process.exitCode = 1;
		return;
	} finally {
		dbConnection?.sqlite.close(false);
	}
}
