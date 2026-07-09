import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { runProfileScan } from "../modules/scans/profile-runner";
import {
	ProjectResolutionError,
	resolveProjectByPath,
} from "../modules/scans/project-resolver";
import { FindingRepository } from "../modules/scans/repositories";
import { normalizeToolExecutionConfig } from "../modules/scans/tools/tool-process-runner";

const ORACLE_PROFILE = "agent-output";

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

	const execution = normalizeToolExecutionConfig({
		runner: "host",
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
		const scanResult = await runProfileScan({
			db: dbConnection.db,
			projectId: resolvedProject.project.id,
			profileId: ORACLE_PROFILE,
			repoPath: resolvedProject.repoPath,
			continueOnToolFailure: true,
			execution,
			finalReport: {
				enabled: true,
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
			profile: ORACLE_PROFILE,
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

		const reviewPayload: OracleResult["review"] = { status: "not_requested" };

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
						? "run_scan_review"
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
