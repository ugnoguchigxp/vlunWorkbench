import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { parseArgs } from "node:util";
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
import { resolveDefaultCatalogProfileId } from "../modules/scans/profile-catalog";
import {
	normalizeProfileResolutionInput,
	ProfileResolutionError,
	resolveProfileSelection,
} from "../modules/scans/profile-resolution";
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
	type DockerNetworkMode,
	normalizeToolExecutionConfig,
	type ToolRunnerKind,
} from "../modules/scans/tools/tool-process-runner";
import { SettingsRepository } from "../modules/settings/settings.repository";
import { ProjectPathPolicyError } from "../security/project-path-policy";
import { runCliAutomatedDiagnostic } from "./scan-profile-diagnostic";
import { buildScanProfileDryRun } from "./scan-profile-dry-run";
import { scanProfileExitCode } from "./scan-profile-exit-code";
import { parseScanTargetOption } from "./scan-profile-options";

const MAX_SCAN_STEP_TIMEOUT_SEC = 86_400;

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean) {
	if (value === undefined) return defaultValue;
	return value !== "false";
}

function parseScanProfileArgs() {
	return parseArgs({
		args: process.argv.slice(2),
		options: {
			"project-id": { type: "string" },
			"scan-run-id": { type: "string" },
			"execution-surface": { type: "string" },
			"project-path": { type: "string" },
			"workspace-target-grant-ref": { type: "string" },
			"create-project": { type: "string", default: "false" },
			profile: { type: "string" },
			target: { type: "string", default: "full" },
			base: { type: "string" },
			head: { type: "string" },
			"include-untracked": { type: "string" },
			"expected-target-digest": { type: "string" },
			"expected-preflight-binding-hash": { type: "string" },
			"expected-plan-hash": { type: "string" },
			"expected-catalog-entry-hash": { type: "string" },
			"result-policy": { type: "string" },
			"allow-experimental": { type: "string", default: "false" },
			preview: { type: "string", default: "false" },
			step: { type: "string" },
			"timeout-sec": { type: "string" },
			"continue-on-tool-failure": { type: "string", default: "true" },
			"consent-project-code-execution": {
				type: "string",
				default: "false",
			},
			"output-summary": { type: "string" },
			"dry-run": { type: "string", default: "false" },
			"final-report": { type: "string", default: "true" },
			"automated-diagnostic": { type: "string", default: "true" },
			"report-title": { type: "string" },
			"report-output": { type: "string" },
			runner: { type: "string" },
			"docker-bin": { type: "string" },
			"docker-image": { type: "string" },
			network: { type: "string", default: "none" },
			memory: { type: "string" },
			cpus: { type: "string" },
			"tool-cache-dir": { type: "string" },
			"dependency-resolution": { type: "string", default: "offline" },
			"image-ref": { type: "string" },
			"image-tar": { type: "string" },
			"attestation-subject": { type: "string" },
			"attestation-bundle": { type: "string" },
			"trust-policy": { type: "string" },
			"slsa-provenance": { type: "string" },
			"slsa-policy": { type: "string" },
			"auth-context-id": { type: "string" },
			"identity-role": { type: "string" },
			json: { type: "boolean", default: false },
		},
		strict: true,
	}).values;
}

async function main() {
	let argsValues: ReturnType<typeof parseScanProfileArgs>;
	try {
		argsValues = parseScanProfileArgs();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${message}`,
		});
		process.exit(1);
	}

	const projectId = argsValues["project-id"];
	const scanRunId = argsValues["scan-run-id"];
	const executionSurface = argsValues["execution-surface"] ?? "cli";
	const projectPath = argsValues["project-path"];
	const workspaceTargetGrantRef = argsValues["workspace-target-grant-ref"];
	const createProject = parseBooleanFlag(argsValues["create-project"], false);
	let scanTarget: ScanTarget;
	try {
		scanTarget = parseScanTargetOption(argsValues);
	} catch (error) {
		writeResult({
			ok: false,
			status: "config_error",
			message: error instanceof Error ? error.message : String(error),
		});
		process.exit(2);
	}
	const profileId =
		argsValues.profile ?? resolveDefaultCatalogProfileId(scanTarget.kind);
	const expectedTargetDigest = argsValues["expected-target-digest"] as
		| string
		| undefined;
	if (expectedTargetDigest && !/^[0-9a-f]{64}$/i.test(expectedTargetDigest)) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--expected-target-digest must be a 64-character SHA-256.",
		});
		process.exit(2);
	}
	const expectedPreflightBindingHash = argsValues[
		"expected-preflight-binding-hash"
	] as string | undefined;
	if (
		expectedPreflightBindingHash &&
		!/^sha256:[0-9a-f]{64}$/.test(expectedPreflightBindingHash)
	) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--expected-preflight-binding-hash must be a sha256: digest.",
		});
		process.exit(2);
	}
	const expectedPlanHash = argsValues["expected-plan-hash"] as
		| string
		| undefined;
	if (expectedPlanHash && !/^sha256:[0-9a-f]{64}$/.test(expectedPlanHash)) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--expected-plan-hash must be a sha256: digest.",
		});
		process.exit(2);
	}
	const expectedCatalogEntryHash = argsValues["expected-catalog-entry-hash"] as
		| string
		| undefined;
	if (
		expectedCatalogEntryHash &&
		!/^sha256:[0-9a-f]{64}$/.test(expectedCatalogEntryHash)
	) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--expected-catalog-entry-hash must be a sha256: digest.",
		});
		process.exit(2);
	}
	const resultPolicy = argsValues["result-policy"] as
		| "advisory"
		| "gate"
		| undefined;
	if (
		resultPolicy !== undefined &&
		resultPolicy !== "advisory" &&
		resultPolicy !== "gate"
	) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--result-policy must be advisory or gate.",
		});
		process.exit(2);
	}
	const allowExperimental = argsValues["allow-experimental"] === "true";
	const preview = argsValues.preview === "true";
	const stepId = argsValues.step;
	const timeoutSecStr = argsValues["timeout-sec"];
	const continueOnToolFailure =
		argsValues["continue-on-tool-failure"] !== "false";
	const consentProjectCodeExecution =
		argsValues["consent-project-code-execution"] === "true";
	const outputSummaryPath = argsValues["output-summary"];
	const dryRun = argsValues["dry-run"] === "true";
	const finalReportEnabled = parseBooleanFlag(argsValues["final-report"], true);
	const automatedDiagnosticEnabled = parseBooleanFlag(
		argsValues["automated-diagnostic"],
		true,
	);
	const reportTitle = argsValues["report-title"];
	const reportOutputPath = argsValues["report-output"];
	const imageRef = argsValues["image-ref"];
	const imageTar = argsValues["image-tar"];
	const attestationSubject = argsValues["attestation-subject"];
	const attestationBundle = argsValues["attestation-bundle"];
	const trustPolicy = argsValues["trust-policy"];
	const slsaProvenance = argsValues["slsa-provenance"];
	const slsaPolicy = argsValues["slsa-policy"];
	const authContextId = argsValues["auth-context-id"];
	const identityRole = argsValues["identity-role"];
	const dependencyResolutionMode = argsValues["dependency-resolution"] as
		| "offline"
		| "registry";
	if (
		dependencyResolutionMode !== "offline" &&
		dependencyResolutionMode !== "registry"
	) {
		writeResult({
			ok: false,
			status: "config_error",
			message: "--dependency-resolution must be offline or registry.",
		});
		process.exit(2);
	}
	if (Boolean(authContextId) !== Boolean(identityRole)) {
		writeResult({
			ok: false,
			status: "config_error",
			message:
				"--auth-context-id and --identity-role must be provided together.",
		});
		process.exit(2);
	}
	if (imageRef && imageTar) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Use only one of --image-ref or --image-tar.",
		});
		process.exit(2);
	}
	const runner = argsValues.runner as ToolRunnerKind | undefined;
	const networkMode = argsValues.network as DockerNetworkMode;

	if (runner !== undefined && runner !== "host" && runner !== "docker") {
		writeResult({
			ok: false,
			status: "failed",
			message: "--runner must be host or docker.",
		});
		process.exit(1);
	}
	if (networkMode !== "none" && networkMode !== "default") {
		writeResult({
			ok: false,
			status: "failed",
			message: "--network must be none or default.",
		});
		process.exit(1);
	}

	if (executionSurface !== "cli" && executionSurface !== "web") {
		writeResult({
			ok: false,
			status: "failed",
			message: "--execution-surface must be cli or web.",
		});
		process.exit(2);
	}

	let selection: ReturnType<typeof resolveProfileSelection>;
	try {
		selection = resolveProfileSelection({
			requestedProfileId: profileId,
			surface: executionSurface,
			target: scanTarget,
			providedInputKinds: normalizeProfileResolutionInput({
				repoPath: projectPath ?? "project-id",
				imageRef,
				imageTar,
				attestationSubject,
				attestationBundle,
				trustPolicy,
				slsaProvenance,
				slsaPolicy,
				authContextRef: authContextId,
				executionConsent: consentProjectCodeExecution,
			}),
			requestedResultPolicy: resultPolicy,
			allowExperimental,
		});
	} catch (error) {
		writeResult({
			ok: false,
			status: "config_error",
			message:
				error instanceof ProfileResolutionError
					? `${error.code}: ${error.message}`
					: error instanceof Error
						? error.message
						: String(error),
		});
		process.exit(2);
	}
	const profile = selection.executionProfile;

	const timeoutSec = timeoutSecStr
		? Number.parseInt(timeoutSecStr, 10)
		: undefined;
	if (
		timeoutSec !== undefined &&
		(!Number.isFinite(timeoutSec) ||
			!Number.isInteger(timeoutSec) ||
			timeoutSec <= 0 ||
			timeoutSec > MAX_SCAN_STEP_TIMEOUT_SEC)
	) {
		writeResult({
			ok: false,
			status: "failed",
			message: `--timeout-sec must be an integer between 1 and ${MAX_SCAN_STEP_TIMEOUT_SEC}.`,
		});
		process.exit(1);
	}

	if (dryRun && !projectId && !projectPath) {
		const dryRunResult = buildScanProfileDryRun({
			profile,
			scanTarget,
			stepId,
			timeoutSec,
			runner,
			finalReportEnabled,
			automatedDiagnosticEnabled,
			imageRef,
			imageTar,
			expectedPreflightBindingHash,
			expectedPlanHash,
			expectedCatalogEntryHash,
			profileResolution: selection.resolution,
		});
		writeResult(dryRunResult);
		process.exit(dryRunResult.ok === false ? 1 : 0);
	}

	if (!projectId && !projectPath) {
		writeResult({
			ok: false,
			status: "config_error",
			message:
				"Missing required argument: --project-path is required unless --project-id is provided.",
			error: {
				code: "PROJECT_INPUT_REQUIRED",
				message:
					"Missing required argument: --project-path is required unless --project-id is provided.",
			},
		});
		process.exit(2);
	}

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
							dockerBin: argsValues["docker-bin"],
							image:
								argsValues["docker-image"] ??
								executionConfigFromPolicy(executionPolicy).docker?.image,
							networkMode,
							memory:
								argsValues.memory ??
								executionConfigFromPolicy(executionPolicy).docker?.memory,
							cpus:
								argsValues.cpus ??
								executionConfigFromPolicy(executionPolicy).docker?.cpus,
							toolCacheDir: argsValues["tool-cache-dir"],
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
				profileResolution: selection.resolution,
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

main();
