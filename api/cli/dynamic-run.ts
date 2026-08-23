import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { MAX_DYNAMIC_TIMEOUT_SEC } from "../../shared/schemas/dynamic.schema";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { DynamicRunner } from "../modules/dynamic/dynamic-runner";
import { SettingsRepository } from "../modules/settings/settings.repository";

type DynamicCliArgs = {
	"project-id"?: string;
	profile?: string;
	"finding-id"?: string;
	"scan-run-id"?: string;
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
	"consent-project-code-execution"?: string;
};

function writeResult(payload: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export async function main(
	argv = process.argv.slice(2),
	write = writeResult,
): Promise<number> {
	let argsValues: DynamicCliArgs;
	try {
		const parsed = parseArgs({
			args: argv,
			options: {
				"project-id": { type: "string" },
				profile: { type: "string" },
				"finding-id": { type: "string" },
				"scan-run-id": { type: "string" },
				runner: { type: "string", default: "docker" },
				"docker-bin": { type: "string" },
				"docker-image": { type: "string" },
				network: { type: "string" },
				"timeout-sec": { type: "string" },
				memory: { type: "string" },
				cpus: { type: "string" },
				"tool-cache-dir": { type: "string" },
				"output-summary": { type: "string" },
				"dry-run": { type: "string", default: "false" },
				"consent-project-code-execution": {
					type: "string",
					default: "false",
				},
			},
			strict: true,
		});
		argsValues = parsed.values as DynamicCliArgs;
	} catch (err) {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message: `Failed to parse arguments: ${(err as Error).message}`,
		});
		return 1;
	}

	const projectId = argsValues["project-id"];
	const profileId = argsValues.profile;
	const findingId = argsValues["finding-id"] || null;
	const scanRunId = argsValues["scan-run-id"] || null;
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
	const consentProjectCodeExecution =
		argsValues["consent-project-code-execution"] === "true";

	if (!projectId) {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message: "Missing required argument: --project-id is required.",
		});
		return 1;
	}

	if (!profileId) {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message: "Missing required argument: --profile is required.",
		});
		return 1;
	}
	if (!dryRun && !consentProjectCodeExecution) {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message:
				"--consent-project-code-execution true is required for dynamic execution.",
		});
		return 1;
	}

	if (runner !== "docker") {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message: "--runner must be docker. Host execution is not allowed.",
		});
		return 1;
	}
	if (!dryRun && !scanRunId) {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message:
				"--scan-run-id is required for execution so Dynamic resources have a recoverable parent lease.",
		});
		return 1;
	}

	if (network !== undefined && network !== "none" && network !== "default") {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message: "--network must be none or default.",
		});
		return 1;
	}

	const timeoutSec = timeoutSecStr
		? Number.parseInt(timeoutSecStr, 10)
		: undefined;
	if (
		timeoutSec !== undefined &&
		(!Number.isFinite(timeoutSec) ||
			!Number.isInteger(timeoutSec) ||
			timeoutSec <= 0 ||
			timeoutSec > MAX_DYNAMIC_TIMEOUT_SEC)
	) {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message: `--timeout-sec must be an integer between 1 and ${MAX_DYNAMIC_TIMEOUT_SEC}.`,
		});
		return 1;
	}

	// Setup DB connection
	const startupEnv = readAppEnv();
	const dbConnection = createDbConnection(startupEnv.databaseUrl);
	const env = await new SettingsRepository(dbConnection.db).resolveAppEnv(
		startupEnv,
	);
	const runnerInstance = new DynamicRunner(dbConnection.db, {
		qualifiedDynamicImage: process.env.VULN_WORKBENCH_DYNAMIC_IMAGE,
		outputLimits: {
			stdoutBytes: env.scannerStdoutLimitBytes,
			stderrBytes: env.scannerStderrLimitBytes,
		},
		dockerDefaults: {
			memory: env.dockerMemory,
			cpus: env.dockerCpus === undefined ? undefined : String(env.dockerCpus),
			pidsLimit: env.dockerPidsLimit,
		},
	});

	try {
		// Set Docker bin env if provided
		if (dockerBin) {
			process.env.VULN_WORKBENCH_DOCKER_BIN = dockerBin;
		}

		const runOptions = {
			projectId,
			profileId,
			scanRunId,
			findingId,
			runner: "docker" as const,
			dockerImage,
			network: network as "none" | "default" | undefined,
			timeoutSec,
			memory,
			cpus,
			toolCacheDir,
		};

		if (dryRun) {
			const dryResult = await runnerInstance.dryRun(runOptions);
			write(dryResult);
			return 0;
		}

		// Perform execution
		const runResult = await runnerInstance.run({
			...runOptions,
			executionConsent: true,
		});

		// Write output summary if specified
		if (outputSummaryPath) {
			try {
				await fs.writeFile(
					outputSummaryPath,
					JSON.stringify(runResult, null, 2),
					"utf8",
				);
			} catch (err) {
				console.error(
					`Failed to write output summary: ${(err as Error).message}`,
				);
			}
		}

		write(runResult);
		return 0;
	} catch (err) {
		write({
			ok: false,
			status: "failed",
			outcome: "error",
			message:
				(err as Error).message ||
				"An unexpected error occurred during dynamic execution",
		});
		return 1;
	} finally {
		dbConnection.sqlite.close(false);
	}
}

if (import.meta.main) {
	void main().then((exitCode) => {
		process.exitCode = exitCode;
	});
}
