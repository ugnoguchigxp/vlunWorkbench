import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { MAX_REPRODUCTION_TIMEOUT_SEC } from "../../shared/schemas/reproduction.schema";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { getReproductionProfileById } from "../modules/reproductions/profiles";
import { ReproductionRunner } from "../modules/reproductions/reproduction-runner";

type ReproCliArgs = {
	"finding-id"?: string;
	"scan-run-id"?: string;
	profile?: string;
	runner?: string;
	"docker-bin"?: string;
	"docker-image"?: string;
	network?: string;
	"timeout-sec"?: string;
	memory?: string;
	cpus?: string;
	"tool-cache-dir"?: string;
	"output-summary"?: string;
	"dry-run"?: string;
};

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	let argsValues: ReproCliArgs;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"finding-id": { type: "string" },
				"scan-run-id": { type: "string" },
				profile: { type: "string" },
				runner: { type: "string", default: "docker" },
				"docker-bin": { type: "string" },
				"docker-image": {
					type: "string",
					default: "vuln-workbench-toolbox:local",
				},
				network: { type: "string", default: "none" },
				"timeout-sec": { type: "string" },
				memory: { type: "string" },
				cpus: { type: "string" },
				"tool-cache-dir": { type: "string" },
				"output-summary": { type: "string" },
				"dry-run": { type: "string", default: "false" },
			},
			strict: true,
		});
		argsValues = parsed.values as ReproCliArgs;
	} catch (err) {
		writeResult({
			ok: false,
			status: "failed",
			outcome: "error",
			message: `Failed to parse arguments: ${(err as Error).message}`,
		});
		process.exit(1);
	}

	const findingId = argsValues["finding-id"];
	const scanRunId = argsValues["scan-run-id"];
	const profileId = argsValues.profile;
	const runner = argsValues.runner;
	const dockerBin = argsValues["docker-bin"];
	const dockerImage = argsValues["docker-image"];
	const network = argsValues.network;
	const timeoutSecStr = argsValues["timeout-sec"];
	const memory = argsValues.memory;
	const cpus = argsValues.cpus;
	const toolCacheDir = argsValues["tool-cache-dir"];
	const outputSummaryPath = argsValues["output-summary"];
	const dryRun = argsValues["dry-run"] === "true";

	if (!findingId) {
		writeResult({
			ok: false,
			status: "failed",
			outcome: "error",
			message: "Missing required argument: --finding-id is required.",
		});
		process.exit(1);
	}

	if (!profileId) {
		writeResult({
			ok: false,
			status: "failed",
			outcome: "error",
			message: "Missing required argument: --profile is required.",
		});
		process.exit(1);
	}

	if (runner !== "docker") {
		writeResult({
			ok: false,
			status: "failed",
			outcome: "error",
			message: "--runner must be docker. Host execution is not allowed.",
		});
		process.exit(1);
	}

	if (network !== "none" && network !== "default") {
		writeResult({
			ok: false,
			status: "failed",
			outcome: "error",
			message: "--network must be none or default.",
		});
		process.exit(1);
	}

	const profile = getReproductionProfileById(profileId);
	if (!profile) {
		writeResult({
			ok: false,
			status: "failed",
			outcome: "error",
			message: `Profile not found: ${profileId}`,
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
			timeoutSec <= 0 ||
			timeoutSec > MAX_REPRODUCTION_TIMEOUT_SEC)
	) {
		writeResult({
			ok: false,
			status: "failed",
			outcome: "error",
			message: `--timeout-sec must be an integer between 1 and ${MAX_REPRODUCTION_TIMEOUT_SEC}.`,
		});
		process.exit(1);
	}

	// Setup DB connection
	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);
	const runnerInstance = new ReproductionRunner(dbConnection.db);

	try {
		// Set Docker bin env if provided
		if (dockerBin) {
			process.env.VULN_WORKBENCH_DOCKER_BIN = dockerBin;
		}

		const runOptions = {
			findingId,
			scanRunId,
			profileId,
			runner: "docker" as const,
			dockerImage,
			network: network as "none" | "default",
			timeoutSec,
			memory,
			cpus,
			toolCacheDir,
		};

		if (dryRun) {
			const dryResult = await runnerInstance.dryRun(runOptions);
			writeResult(dryResult);
			process.exit(0);
		}

		// Perform execution
		const runResult = await runnerInstance.run(runOptions);

		// Write output summary if specified
		if (outputSummaryPath) {
			try {
				await fs.writeFile(
					outputSummaryPath,
					JSON.stringify(runResult, null, 2),
					"utf8",
				);
			} catch (err) {
				// We don't fail the whole execution if only summary write fails,
				// but we can log a warning in stderr (though we want stdout clean)
				console.error(
					`Failed to write output summary: ${(err as Error).message}`,
				);
			}
		}

		writeResult(runResult);
		// Exit successfully since DB was updated and JSON was printed.
		process.exit(0);
	} catch (err) {
		writeResult({
			ok: false,
			status: "failed",
			outcome: "error",
			message:
				(err as Error).message ||
				"An unexpected error occurred during reproduction",
		});
		process.exit(1);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

main();
