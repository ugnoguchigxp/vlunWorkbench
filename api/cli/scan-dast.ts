import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { DastRunner } from "../modules/dast/dast-runner";

type DastCliArgs = {
	"project-id"?: string;
	"target-config-id"?: string;
	profile?: string;
	"profile-config-id"?: string;
	"scan-run-id"?: string;
	runner?: string;
	"docker-image"?: string;
	"timeout-sec"?: string;
	"max-requests"?: string;
	"dry-run"?: string;
};

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
				profile: { type: "string" },
				"profile-config-id": { type: "string" },
				"scan-run-id": { type: "string" },
				runner: { type: "string", default: "host" },
				"docker-image": { type: "string" },
				"timeout-sec": { type: "string" },
				"max-requests": { type: "string" },
				"dry-run": { type: "string", default: "false" },
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
			failureKind: "target_validation_failed",
			message: `Failed to parse arguments: ${(error as Error).message}`,
		});
		process.exit(1);
	}

	const projectId = values["project-id"];
	const targetConfigId = values["target-config-id"];
	const profileId = values.profile;
	if (!projectId || !targetConfigId || !profileId) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "target_validation_failed",
			message:
				"Missing required arguments: --project-id, --target-config-id, and --profile are required.",
		});
		process.exit(1);
	}
	if (
		values.runner !== undefined &&
		values.runner !== "host" &&
		values.runner !== "docker" &&
		values.runner !== "mock"
	) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "target_validation_failed",
			message: "--runner must be host, docker, or mock.",
		});
		process.exit(1);
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
			failureKind: "target_validation_failed",
			message: (error as Error).message,
		});
		process.exit(1);
	}

	const env = readAppEnv();
	const connection = createDbConnection(env.databaseUrl);
	try {
		const runner = new DastRunner(connection.db);
		const runOptions = {
			projectId,
			targetConfigId,
			profileId,
			profileConfigId: values["profile-config-id"] ?? null,
			scanRunId: values["scan-run-id"] ?? null,
			runner: values.runner as "host" | "docker" | "mock",
			dockerImage: values["docker-image"],
			timeoutSec,
			maxRequests,
			dryRun: values["dry-run"] === "true",
		};
		const result = runOptions.dryRun
			? await runner.dryRun(runOptions)
			: await runner.run(runOptions);
		writeResult(result);
		process.exit(result.ok || result.dastRunId ? 0 : 1);
	} catch (error) {
		writeResult({
			ok: false,
			dastRunId: null,
			scanRunId: values["scan-run-id"] ?? null,
			status: "failed",
			outcome: "error",
			failureKind: "runner_failed",
			message:
				error instanceof Error ? error.message : "DAST execution failed.",
		});
		process.exit(1);
	} finally {
		connection.sqlite.close(false);
	}
}

main();
