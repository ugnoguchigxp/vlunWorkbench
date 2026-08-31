import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { DastRunner, type DastCliResult } from "../modules/dast/dast-runner";
import { DastAuthContextCrypto } from "../modules/dast/auth-context-crypto";
import { DastAuthContextRepository } from "../modules/dast/auth-context-repository";
import { runCliAutomatedDiagnostic } from "./scan-profile-diagnostic";

type DastCliArgs = {
	"project-id"?: string;
	"target-config-id"?: string;
	"auto-target"?: string;
	profile?: string;
	"profile-config-id"?: string;
	"scan-run-id"?: string;
	runner?: string;
	"docker-image"?: string;
	"timeout-sec"?: string;
	"max-requests"?: string;
	"dry-run"?: string;
	"auth-context-id"?: string;
	"identity-role"?: string;
	"created-by-user-id"?: string;
};

class DastCliResultError extends Error {
	constructor(readonly result: Record<string, unknown>) {
		super(typeof result.message === "string" ? result.message : "DAST failed.");
	}
}

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function parsePositiveInt(
	value: string | undefined,
	label: string,
): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return parsed;
}

async function main() {
	let values: DastCliArgs;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-id": { type: "string" },
				"target-config-id": { type: "string" },
				"auto-target": { type: "string", default: "false" },
				profile: { type: "string" },
				"profile-config-id": { type: "string" },
				"scan-run-id": { type: "string" },
				runner: { type: "string", default: "host" },
				"docker-image": { type: "string" },
				"timeout-sec": { type: "string" },
				"max-requests": { type: "string" },
				"dry-run": { type: "string", default: "false" },
				"auth-context-id": { type: "string" },
				"identity-role": { type: "string" },
				"created-by-user-id": { type: "string" },
			},
			strict: true,
		});
		values = parsed.values as DastCliArgs;
	} catch (error) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message: `Failed to parse arguments: ${(error as Error).message}`,
		});
		process.exit(1);
	}

	const projectId = values["project-id"];
	const targetConfigId = values["target-config-id"];
	const autoTarget = values["auto-target"] === "true";
	const profileId = values.profile;
	if (!projectId || !profileId || (!targetConfigId && !autoTarget)) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message:
				"Missing required arguments: --project-id and --profile are required. Provide --target-config-id or --auto-target true.",
		});
		process.exit(1);
	}
	if (
		values.runner !== undefined &&
		values.runner !== "host" &&
		values.runner !== "docker"
	) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message: "--runner must be host or docker.",
		});
		process.exit(1);
	}
	if (autoTarget) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message:
				"--auto-target is unavailable until an isolated runtime bundle provider is configured.",
		});
		process.exitCode = 1;
		return;
	}

	let timeoutSec: number | undefined;
	let maxRequests: number | undefined;
	try {
		timeoutSec = parsePositiveInt(values["timeout-sec"], "--timeout-sec");
		maxRequests = parsePositiveInt(values["max-requests"], "--max-requests");
	} catch (error) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "dast_target_rejected",
			message: (error as Error).message,
		});
		process.exit(1);
	}

	const env = readAppEnv();
	if (!env.dastStandardV2Enabled && profileId.includes("standard")) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			verdict: "not_tested",
			coverageStatus: "gap",
			failureKind: "dast_target_rejected",
			message: "DAST standard v2 is disabled.",
		});
		process.exit(1);
	}
	const connection = createDbConnection(env.databaseUrl);
	let finalResult: Record<string, unknown> | null = null;
	let finalExitCode = 1;
	let runnerResult: DastCliResult | null = null;
	let dryRun = false;
	try {
		const authContextRepository = env.dastAuthEncryptionKey
			? new DastAuthContextRepository(
					connection.db,
					new DastAuthContextCrypto(
						env.dastAuthEncryptionKey,
						env.dastAuthPreviousEncryptionKeys,
					),
				)
			: undefined;
		const runner = new DastRunner(connection.db, { authContextRepository });
		dryRun = values["dry-run"] === "true";
		const runOptions = {
			projectId,
			targetConfigId: targetConfigId as string,
			profileId,
			profileConfigId: values["profile-config-id"] ?? null,
			scanRunId: values["scan-run-id"] ?? null,
			runner: values.runner as "host" | "docker",
			dockerImage: values["docker-image"],
			timeoutSec,
			maxRequests,
			dryRun,
			authContextId: values["auth-context-id"] ?? null,
			identityRole: values["identity-role"] ?? null,
			createdByUserId: values["created-by-user-id"] ?? null,
			manageScanRunStatus: true,
		};
		const result = runOptions.dryRun
			? await runner.dryRun(runOptions)
			: await runner.run(runOptions);
		runnerResult = result;
		finalResult = { ...result };
		finalExitCode = result.ok || result.dastRunId ? 0 : 1;
	} catch (error) {
		finalResult =
			error instanceof DastCliResultError
				? error.result
				: {
						ok: false,
						dastRunId: null,
						scanRunId: values["scan-run-id"] ?? null,
						status: "failed",
						outcome: "error",
						failureKind: "unknown_error",
						message:
							error instanceof Error ? error.message : "DAST execution failed.",
					};
		finalExitCode = 1;
	}
	const diagnostic =
		finalResult?.ok === true && runnerResult?.scanRunId && !dryRun
			? await runCliAutomatedDiagnostic({
					db: connection.db,
					env,
					scanRunId: runnerResult.scanRunId,
				}).catch((error) => ({
					status: "failed" as const,
					readiness: "failed" as const,
					error:
						error instanceof Error
							? error.message
							: "Automated diagnostic failed.",
				}))
			: null;
	if (finalResult) finalResult = { ...finalResult, diagnostic };
	connection.sqlite.close(false);
	writeResult(
		finalResult ?? {
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "unknown_error",
			message: "DAST execution did not produce a result.",
		},
	);
	process.exitCode = finalExitCode;
}

main();
