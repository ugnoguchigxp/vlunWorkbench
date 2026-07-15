import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { runProfileScan } from "../modules/scans/profile-runner";
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
import {
	type DockerNetworkMode,
	normalizeToolExecutionConfig,
	type ToolRunnerKind,
} from "../modules/scans/tools/tool-process-runner";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean) {
	if (value === undefined) return defaultValue;
	return value !== "false";
}

async function main() {
	// biome-ignore lint/suspicious/noExplicitAny: CLI args
	let argsValues: any;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-id": { type: "string" },
				"scan-run-id": { type: "string" },
				"execution-surface": { type: "string" },
				"project-path": { type: "string" },
				"create-project": { type: "string", default: "false" },
				profile: { type: "string", default: "baseline" },
				step: { type: "string" },
				"timeout-sec": { type: "string" },
				"continue-on-tool-failure": { type: "string", default: "true" },
				"output-summary": { type: "string" },
				"dry-run": { type: "string", default: "false" },
				"final-report": { type: "string", default: "true" },
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
		});
		argsValues = parsed.values;
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
	const createProject = parseBooleanFlag(argsValues["create-project"], false);
	const profileId = argsValues.profile;
	const stepId = argsValues.step;
	const timeoutSecStr = argsValues["timeout-sec"];
	const continueOnToolFailure =
		argsValues["continue-on-tool-failure"] !== "false";
	const outputSummaryPath = argsValues["output-summary"];
	const dryRun = argsValues["dry-run"] === "true";
	const finalReportEnabled = parseBooleanFlag(argsValues["final-report"], true);
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

	if (dryRun) {
		// Output dry-run details and exit
		const toolOrder = profile.tools.map((t) => t.toolId);
		const allSteps = profile.steps ?? [];
		const selectedSteps = stepId
			? allSteps.filter((step) => {
					const id =
						step.kind === "static_tool"
							? step.toolId
							: step.kind === "dast"
								? `dast:${step.profileId}`
								: `${step.kind}:${step.adapter}`;
					return id === stepId;
				})
			: allSteps;
		if (stepId && selectedSteps.length === 0) {
			writeResult({
				ok: false,
				status: "failed",
				message: `Invalid profile step: ${stepId}`,
			});
			process.exit(1);
		}
		const stepOrder = selectedSteps.map((step) =>
			step.kind === "static_tool"
				? step.toolId
				: step.kind === "dast"
					? `dast:${step.profileId}`
					: `${step.kind}:${step.adapter}`,
		);
		const resolvedTools = profile.tools.map((t) => ({
			toolId: t.toolId,
			displayName: t.displayName,
			required: t.required,
			timeoutSec: t.timeoutSec ?? timeoutSec ?? profile.defaultTimeoutSec,
			options: t.options ?? {},
		}));
		const resolvedSteps = selectedSteps.map((step) => ({
			kind: step.kind,
			id:
				step.kind === "static_tool"
					? step.toolId
					: step.kind === "dast"
						? `dast:${step.profileId}`
						: `${step.kind}:${step.adapter}`,
			displayName: step.displayName,
			required: step.required,
			timeoutSec: step.timeoutSec ?? timeoutSec ?? profile.defaultTimeoutSec,
			failurePolicy: step.failurePolicy,
			target: "target" in step ? step.target : undefined,
			applicabilityInput:
				step.kind === "container_image_scan"
					? imageRef
						? "image-ref"
						: imageTar
							? "image-tar"
							: "missing"
					: undefined,
		}));
		writeResult({
			dryRun: true,
			profileId,
			runner: runner ?? "host",
			finalReport: finalReportEnabled,
			stepId: stepId ?? null,
			toolOrder,
			stepOrder,
			resolvedTools,
			resolvedSteps,
		});
		process.exit(0);
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
		const env = readAppEnv();
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
							memory: argsValues.memory,
							cpus: argsValues.cpus,
							toolCacheDir: argsValues["tool-cache-dir"],
						}
					: undefined,
		});
		dbConnection = createDbConnection(env.databaseUrl);
		startupComplete = true;
		const projectRepo = new ProjectRepository(dbConnection.db);
		const projectResolution = projectPath
			? await resolveProjectByPath(dbConnection.db, projectPath, {
					createProject,
				})
			: null;
		const project = projectResolution
			? projectResolution.project
			: await projectRepo.findById(projectId);
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
			process.exit(2);
		}

		const result = await runProfileScan({
			db: dbConnection.db,
			scanRunId,
			projectId: project.id,
			profileId,
			stepId,
			repoPath: projectResolution?.repoPath ?? project.repoPath,
			continueOnToolFailure,
			timeoutSec,
			execution,
			executionPolicyMetadata: scanExecutionPolicyMetadata(executionPolicy),
			imageRef,
			imageTar,
			finalReport: {
				enabled: finalReportEnabled,
				title: reportTitle,
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: true,
			},
		});

		if (reportOutputPath && result.finalReport?.artifactPath) {
			const reportMarkdown = await new ArtifactStorage().readTextArtifact(
				result.finalReport.artifactPath,
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
			process.exit(1);
		}
	} catch (err) {
		if (err instanceof ProjectResolutionError || !startupComplete) {
			const message = err instanceof Error ? err.message : String(err);
			writeResult({
				ok: false,
				status: "config_error",
				message,
				error: {
					code:
						err instanceof ProjectResolutionError
							? err.code
							: "APP_CONFIG_ERROR",
					message,
				},
			});
			process.exit(2);
		}
		writeResult({
			ok: false,
			runner: runner ?? "host",
			status: "failed",
			message: err instanceof Error ? err.message : String(err),
			toolResults: [],
		});
		process.exit(1);
	} finally {
		dbConnection?.sqlite.close(false);
	}
}

main();
