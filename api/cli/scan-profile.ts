import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import type { ScanTarget } from "../../shared/schemas/scan-target.schema";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { resolveWorkspaceTargetGrantPath } from "../modules/integrations/nightworkers/nightworkers-workspace-target-grant-cli";
import { analyzeProjectCapabilities } from "../modules/project-capabilities/plugin-detector";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import {
	buildDiffScanPlan,
	toDiffScanPreview,
} from "../modules/scans/diff-scan-plan";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "../modules/scans/git-diff-resolver";
import {
	resolveProfileSteps,
	runProfileScan,
} from "../modules/scans/profile-runner";
import { getProfileById } from "../modules/scans/profiles";
import {
	ProjectResolutionError,
	resolveProjectByPath,
} from "../modules/scans/project-resolver";
import { ProjectRepository } from "../modules/scans/repositories";
import {
	executionConfigFromPolicy,
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
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
import { parseScanTargetOption } from "./scan-profile-options";

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
			profile: { type: "string", default: "baseline" },
			target: { type: "string", default: "full" },
			base: { type: "string" },
			head: { type: "string" },
			"include-untracked": { type: "string" },
			"expected-target-digest": { type: "string" },
			"expected-preflight-binding-hash": { type: "string" },
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
			"image-ref": { type: "string" },
			"image-tar": { type: "string" },
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
	const profileId = argsValues.profile;
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

	// Validate profile exists
	const profile = getProfileById(profileId);
	if (!profile) {
		writeResult({
			ok: false,
			status: "failed",
			message: `Invalid profile: ${profileId}`,
		});
		process.exit(1);
	}

	const timeoutSec = timeoutSecStr
		? Number.parseInt(timeoutSecStr, 10)
		: undefined;
	if (
		timeoutSec !== undefined &&
		(!Number.isFinite(timeoutSec) ||
			!Number.isInteger(timeoutSec) ||
			timeoutSec <= 0)
	) {
		writeResult({
			ok: false,
			status: "failed",
			message: "--timeout-sec must be a positive integer.",
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
			const preflight = await runScanPreflight({
				profile,
				steps: resolveProfileSteps({
					steps: profile.steps,
					tools: profile.tools,
					stepId,
				}),
				projectId: project.id,
				repoPath: effectiveRepoPath,
				execution,
				consentProjectCodeExecution,
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
			executionSurface,
			target: scanTarget,
			expectedTargetDigest,
			expectedPreflightBindingHash,
			consentProjectCodeExecution,
			finalReport: {
				enabled: finalReportEnabled,
				title: reportTitle,
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: true,
			},
		});
		const automatedDiagnostic =
			automatedDiagnosticEnabled &&
			executionSurface === "cli" &&
			result.status === "completed"
				? await runCliAutomatedDiagnostic({
						db: dbConnection.db,
						env,
						scanRunId: result.scanRunId,
					})
				: null;
		const reportArtifactPath =
			automatedDiagnostic?.reportArtifactPath ??
			result.finalReport?.artifactPath ??
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
			runner: result.runner,
			status: result.status,
			profileOutcome: result.profileOutcome,
			message: result.message,
			finalReport: result.finalReport,
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

		if (!result.ok) {
			process.exitCode = 1;
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
