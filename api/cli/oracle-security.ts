import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { LlmTaskSchema } from "../modules/llm-settings/llm-settings.schema";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { runProfileScan } from "../modules/scans/profile-runner";
import {
	ProjectResolutionError,
	resolveProjectByPath,
} from "../modules/scans/project-resolver";
import { FindingRepository } from "../modules/scans/repositories";
import { ScanReviewRunner } from "../modules/scans/scan-review-runner";
import { LlmRouter } from "../providers/llmRouter";
import {
	type DockerNetworkMode,
	normalizeToolExecutionConfig,
	type ToolRunnerKind,
} from "../modules/scans/tools/tool-process-runner";

type OracleStatus =
	| "completed"
	| "security_action_required"
	| "inconclusive"
	| "config_error"
	| "runtime_error";

type OracleResult = {
	ok: boolean;
	status: OracleStatus;
	project: {
		id: string;
		repoPath: string;
		created: boolean;
	} | null;
	scan: {
		scanRunId: string;
		profile: string;
		findingCount: number;
		highOrCriticalCount: number;
		reportPath?: string;
	} | null;
	review: {
		status: "not_requested" | "completed" | "failed" | "skipped";
		reviewId?: string;
		improvementRequest?: string;
		error?: string;
	};
	nextAction:
		| "none"
		| "apply_security_fix"
		| "run_scan_review"
		| "configure_provider"
		| "inspect_diagnostic_failure";
	error?: {
		code: string;
		message: string;
	};
};

function writeResult(payload: OracleResult): void {
	console.log(JSON.stringify(payload));
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean) {
	if (value === undefined) return defaultValue;
	return value !== "false";
}

function failureResult(params: {
	status: Extract<OracleStatus, "config_error" | "runtime_error">;
	code: string;
	message: string;
	nextAction?: OracleResult["nextAction"];
	project?: OracleResult["project"];
	scan?: OracleResult["scan"];
	review?: OracleResult["review"];
}): OracleResult {
	return {
		ok: false,
		status: params.status,
		project: params.project ?? null,
		scan: params.scan ?? null,
		review: params.review ?? { status: "skipped" },
		nextAction:
			params.nextAction ??
			(params.status === "config_error"
				? "configure_provider"
				: "inspect_diagnostic_failure"),
		error: {
			code: params.code,
			message: params.message,
		},
	};
}

function exitCodeFor(result: OracleResult): number {
	if (result.status === "completed") return 0;
	if (result.status === "security_action_required") return 3;
	if (result.status === "inconclusive") return 4;
	if (result.status === "config_error") return 2;
	return 1;
}

async function main() {
	let argsValues: Record<string, string | boolean | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-path": { type: "string" },
				profile: { type: "string", default: "agent-output" },
				review: { type: "string", default: "false" },
				format: { type: "string", default: "json" },
				"timeout-sec": { type: "string" },
				"continue-on-tool-failure": { type: "string", default: "true" },
				"final-report": { type: "string", default: "true" },
				runner: { type: "string", default: "host" },
				"docker-bin": { type: "string" },
				"docker-image": { type: "string" },
				network: { type: "string", default: "none" },
				memory: { type: "string" },
				cpus: { type: "string" },
				"tool-cache-dir": { type: "string" },
				task: { type: "string", default: "scan_review" },
				provider: { type: "string", default: "azure-openai" },
				"provider-endpoint-id": { type: "string" },
				model: { type: "string" },
				"fixture-output": { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const result = failureResult({
			status: "config_error",
			code: "ARGUMENT_PARSE_FAILED",
			message: `Failed to parse arguments: ${message}`,
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		process.exit(exitCodeFor(result));
	}

	if (argsValues.format !== "json") {
		const result = failureResult({
			status: "config_error",
			code: "UNSUPPORTED_FORMAT",
			message: "--format must be json.",
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		process.exit(exitCodeFor(result));
	}

	const projectPath = argsValues["project-path"] as string | undefined;
	if (!projectPath) {
		const result = failureResult({
			status: "config_error",
			code: "PROJECT_PATH_REQUIRED",
			message: "Missing required argument: --project-path is required.",
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		process.exit(exitCodeFor(result));
	}

	const runner = argsValues.runner as ToolRunnerKind;
	const networkMode = argsValues.network as DockerNetworkMode;
	if (runner !== "host" && runner !== "docker") {
		const result = failureResult({
			status: "config_error",
			code: "INVALID_RUNNER",
			message: "--runner must be host or docker.",
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		process.exit(exitCodeFor(result));
	}
	if (networkMode !== "none" && networkMode !== "default") {
		const result = failureResult({
			status: "config_error",
			code: "INVALID_NETWORK",
			message: "--network must be none or default.",
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		process.exit(exitCodeFor(result));
	}

	const timeoutSec = argsValues["timeout-sec"]
		? Number.parseInt(argsValues["timeout-sec"] as string, 10)
		: undefined;
	if (
		timeoutSec !== undefined &&
		(!Number.isFinite(timeoutSec) ||
			!Number.isInteger(timeoutSec) ||
			timeoutSec <= 0)
	) {
		const result = failureResult({
			status: "config_error",
			code: "INVALID_TIMEOUT",
			message: "--timeout-sec must be a positive integer.",
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		process.exit(exitCodeFor(result));
	}

	const taskResult = LlmTaskSchema.safeParse(argsValues.task);
	if (!taskResult.success) {
		const result = failureResult({
			status: "config_error",
			code: "UNSUPPORTED_REVIEW_TASK",
			message: `Unsupported task: ${argsValues.task}`,
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		process.exit(exitCodeFor(result));
	}

	const execution = normalizeToolExecutionConfig({
		runner,
		docker:
			runner === "docker"
				? {
						dockerBin: argsValues["docker-bin"] as string | undefined,
						image: argsValues["docker-image"] as string | undefined,
						networkMode,
						memory: argsValues.memory as string | undefined,
						cpus: argsValues.cpus as string | undefined,
						toolCacheDir: argsValues["tool-cache-dir"] as string | undefined,
					}
				: undefined,
	});

	let dbConnection: ReturnType<typeof createDbConnection> | null = null;
	let startupComplete = false;
	try {
		const env = readAppEnv();
		dbConnection = createDbConnection(env.databaseUrl);
		startupComplete = true;
		const resolvedProject = await resolveProjectByPath(
			dbConnection.db,
			projectPath,
			{
				createProject: true,
			},
		);
		const projectPayload = {
			id: resolvedProject.project.id,
			repoPath: resolvedProject.repoPath,
			created: resolvedProject.created,
		};
		const profile =
			(argsValues.profile as string | undefined) ?? "agent-output";
		const scanResult = await runProfileScan({
			db: dbConnection.db,
			projectId: resolvedProject.project.id,
			profileId: profile,
			repoPath: resolvedProject.repoPath,
			continueOnToolFailure: argsValues["continue-on-tool-failure"] !== "false",
			timeoutSec,
			execution,
			finalReport: {
				enabled: parseBooleanFlag(argsValues["final-report"] as string, true),
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: true,
			},
		});

		const findingRepo = new FindingRepository(dbConnection.db);
		const findings = await findingRepo.listFindings(scanResult.scanRunId);
		const highOrCriticalCount = findings.filter((finding) => {
			const severity = finding.severity.toLowerCase();
			return severity === "high" || severity === "critical";
		}).length;
		const scanPayload = {
			scanRunId: scanResult.scanRunId,
			profile,
			findingCount: findings.length,
			highOrCriticalCount,
			...(scanResult.finalReport?.artifactPath
				? { reportPath: scanResult.finalReport.artifactPath }
				: {}),
		};

		if (!scanResult.ok) {
			const result = failureResult({
				status: "runtime_error",
				code: "SCAN_FAILED",
				message: scanResult.message ?? "Scan failed.",
				nextAction: "inspect_diagnostic_failure",
				project: projectPayload,
				scan: scanPayload,
				review: { status: "skipped" },
			});
			writeResult(result);
			process.exit(exitCodeFor(result));
		}

		let reviewPayload: OracleResult["review"] = { status: "not_requested" };
		if (parseBooleanFlag(argsValues.review as string, false)) {
			const llmSettingsRepository = new LlmSettingsRepository(
				dbConnection.db,
				env,
			);
			const llmRouter = new LlmRouter(llmSettingsRepository, env);
			const reviewRunner = new ScanReviewRunner(dbConnection.db, {
				llmRouter,
			});
			const provider = argsValues.provider as string | undefined;
			const providerEndpointId =
				(argsValues["provider-endpoint-id"] as string | undefined) ||
				(provider && provider !== "azure-openai" ? provider : undefined);
			const reviewResult = await reviewRunner.run(scanResult.scanRunId, {
				task: taskResult.data,
				providerEndpointId,
				providerName: provider,
				modelName: argsValues.model as string | undefined,
				fixtureOutput: argsValues["fixture-output"] as string | undefined,
			});
			if (!reviewResult.ok) {
				const result = failureResult({
					status: "config_error",
					code: "SCAN_REVIEW_FAILED",
					message: reviewResult.error ?? "Scan review failed.",
					nextAction: "configure_provider",
					project: projectPayload,
					scan: scanPayload,
					review: {
						status: "failed",
						reviewId: reviewResult.reviewId,
						error: reviewResult.error ?? "Scan review failed.",
					},
				});
				writeResult(result);
				process.exit(exitCodeFor(result));
			}
			reviewPayload = {
				status: "completed",
				reviewId: reviewResult.reviewId,
			};
		}

		const status: OracleStatus =
			scanResult.profileOutcome === "completed_with_warnings"
				? "inconclusive"
				: highOrCriticalCount > 0
					? "security_action_required"
					: "completed";
		const result: OracleResult = {
			ok: status === "completed",
			status,
			project: projectPayload,
			scan: scanPayload,
			review: reviewPayload,
			nextAction:
				status === "security_action_required"
					? "apply_security_fix"
					: status === "inconclusive"
						? parseBooleanFlag(argsValues.review as string, false)
							? "inspect_diagnostic_failure"
							: "run_scan_review"
						: "none",
		};
		writeResult(result);
		process.exit(exitCodeFor(result));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const configError =
			error instanceof ProjectResolutionError || !startupComplete;
		const result = failureResult({
			status: configError ? "config_error" : "runtime_error",
			code:
				error instanceof ProjectResolutionError
					? error.code
					: !startupComplete
						? "APP_CONFIG_ERROR"
						: "ORACLE_RUNTIME_ERROR",
			message,
			nextAction: "inspect_diagnostic_failure",
		});
		writeResult(result);
		process.exit(exitCodeFor(result));
	} finally {
		dbConnection?.sqlite.close(false);
	}
}

await main();
