import { randomBytes } from "node:crypto";
import type { RuntimeIsolationPlanV1 } from "../../../shared/schemas/runtime-isolation.schema";
import {
	cleanupRuntimeBundle,
	type PrivateRuntimeBundleReceipt,
} from "./docker-runtime-bundle";
import type {
	DockerRuntimeBundleRunner,
	RuntimeBundleLeaseRepository,
} from "./docker-runtime-bundle-lifecycle";
import {
	type RuntimeFailureEvidence,
	type RuntimeTargetPreparationError,
	safeRuntimeText,
} from "./runtime-failure";

export async function collectRuntimeFailureEvidence(params: {
	runner: DockerRuntimeBundleRunner;
	dockerBin: string;
	receipt: PrivateRuntimeBundleReceipt;
	stepId: string;
	failure: RuntimeTargetPreparationError;
	readinessTimeoutMs: number;
	readinessPaths: string[];
}): Promise<RuntimeFailureEvidence> {
	const containers = params.receipt.children.filter(
		(child) => child.kind === "container",
	);
	const perStreamLimit = 32 * 1024;
	const evidenceContainers = await Promise.all(
		containers.map(async (child) => {
			const [logs, inspect] = await Promise.all([
				params.runner.run([
					params.dockerBin,
					"logs",
					"--tail",
					"200",
					child.id,
				]),
				params.runner.run([
					params.dockerBin,
					"inspect",
					"--format",
					"{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}",
					child.id,
				]),
			]);
			const [status = null, exitCode = null, oomKilled = null] = inspect.stdout
				.trim()
				.split("|");
			return {
				role: child.role,
				status: status || null,
				exitCode:
					exitCode && /^-?\d+$/.test(exitCode)
						? Number.parseInt(exitCode, 10)
						: null,
				oomKilled:
					oomKilled === "true" ? true : oomKilled === "false" ? false : null,
				stdout: safeRuntimeText(logs.stdout, perStreamLimit),
				stderr: safeRuntimeText(logs.stderr, perStreamLimit),
				truncated:
					Buffer.byteLength(logs.stdout) > perStreamLimit ||
					Buffer.byteLength(logs.stderr) > perStreamLimit,
			};
		}),
	);
	const probe = evidenceContainers.find(
		(container) => container.role === "probe",
	);
	const readiness = readReadinessEvidence({
		probeStdout: probe?.stdout ?? "",
		timeoutMs: params.readinessTimeoutMs,
		paths: params.readinessPaths,
	});
	const bundleId = params.receipt.bundleId;
	return {
		schemaVersion: 1,
		bundleId,
		stepId: params.stepId,
		rootFailure: {
			reasonCode: params.failure.input.reasonCode,
			phase: params.failure.input.phase,
			role: params.failure.input.role,
			operation: params.failure.input.operation,
			exitCode: params.failure.input.exitCode,
		},
		containers: evidenceContainers,
		readiness,
		redacted: true,
	};
}

export function readReadinessEvidence(params: {
	probeStdout: string;
	timeoutMs: number;
	paths: string[];
}): NonNullable<RuntimeFailureEvidence["readiness"]> {
	const fallbackAttempts = Math.max(1, Math.floor(params.timeoutMs / 1_000));
	const fallback = {
		timeoutMs: params.timeoutMs,
		attempts: fallbackAttempts,
		paths: params.paths.map((path) => ({ path, lastResult: "not_ready" })),
	};
	const line = [...params.probeStdout.trim().split("\n")]
		.reverse()
		.find((value) => value.startsWith("{"));
	if (!line) return fallback;
	try {
		const parsed: unknown = JSON.parse(line);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return fallback;
		const record = parsed as Record<string, unknown>;
		const attempts =
			typeof record.attempts === "number" &&
			Number.isSafeInteger(record.attempts) &&
			record.attempts > 0
				? record.attempts
				: fallbackAttempts;
		const results = Array.isArray(record.results)
			? record.results.map((value) =>
					typeof value === "string" &&
					/^(?:http_[1-5]\d\d|connection_error)$/.test(value)
						? value
						: "not_ready",
				)
			: [];
		return {
			timeoutMs: params.timeoutMs,
			attempts,
			paths: params.paths.map((path, index) => ({
				path,
				lastResult: results[index] ?? "not_ready",
			})),
		};
	} catch {
		return fallback;
	}
}

export function databaseReadinessArgs(params: {
	dockerBin: string;
	containerName: string;
	mode: "postgres_ephemeral" | "mysql_ephemeral";
}): string[] {
	const readinessCommand =
		params.mode === "postgres_ephemeral"
			? "pg_isready -h 127.0.0.1 -p 15432"
			: "mysqladmin ping --host=127.0.0.1 --port=13306 --silent";
	return [
		params.dockerBin,
		"exec",
		params.containerName,
		"sh",
		"-ceu",
		`attempt=0; until ${readinessCommand} >/dev/null 2>&1; do attempt=$((attempt+1)); test "$attempt" -lt 60; sleep 1; done`,
	];
}

export function dependencyInstallCommand(
	plan: RuntimeIsolationPlanV1,
	registryUrl: string,
): string[] {
	if (plan.dependency.adapterId === "bun-lock-v1") {
		return [
			"bun",
			"install",
			"--frozen-lockfile",
			"--ignore-scripts",
			"--no-progress",
			"--no-save",
			"--backend=copyfile",
			"--cache-dir=/workspace/.bun-cache",
			"--network-concurrency=8",
			"--registry",
			registryUrl,
		];
	}
	return ["npm", "ci", "--ignore-scripts", "--audit=false", "--fund=false"];
}

export async function stopDockerRuntimeBundle(params: {
	dockerBin: string;
	leaseId: string;
	receipt: PrivateRuntimeBundleReceipt;
	planHash: string;
	runner: DockerRuntimeBundleRunner;
	leaseRepository: RuntimeBundleLeaseRepository;
}): Promise<void> {
	try {
		await cleanupRuntimeBundle({
			dockerBin: params.dockerBin,
			receipt: params.receipt,
			runner: params.runner,
		});
		await params.leaseRepository.release(
			params.leaseId,
			privateReceipt(params.receipt, params.planHash),
		);
	} catch (error) {
		await params.leaseRepository.quarantine(
			params.leaseId,
			privateReceipt(params.receipt, params.planHash),
		);
		throw error;
	}
}

export function privateReceipt(
	receipt: PrivateRuntimeBundleReceipt,
	planHash: string,
): Record<string, unknown> {
	return {
		bundleId: receipt.bundleId,
		scanRunId: receipt.scanRunId,
		planHash,
		children: receipt.children,
	};
}

export function databaseEnvironment(plan: RuntimeIsolationPlanV1): {
	targetEnv: Record<string, string>;
	serviceEnv: Record<string, string>;
	serviceEnvKeys: string[];
} {
	if (plan.database.mode === "none")
		return { targetEnv: {}, serviceEnv: {}, serviceEnvKeys: [] };
	if (plan.database.mode === "sqlite_ephemeral") {
		return bindingEnvironment(plan, {
			host: "",
			port: "",
			database: "",
			username: "",
			password: "",
			url: "",
			file_path: "/runtime-data/app.sqlite",
			file_url: "file:/runtime-data/app.sqlite",
		});
	}
	const postgres = plan.database.mode === "postgres_ephemeral";
	const username = "runtime";
	const password = randomBytes(24).toString("base64url");
	const database = "runtime";
	const port = postgres ? "15432" : "13306";
	const url = postgres
		? `postgresql://${username}:${password}@127.0.0.1:${port}/${database}`
		: `mysql://${username}:${password}@127.0.0.1:${port}/${database}`;
	const target = bindingEnvironment(plan, {
		host: "127.0.0.1",
		port,
		database,
		username,
		password,
		url,
		file_path: "",
		file_url: "",
	});
	const serviceEnv: Record<string, string> = postgres
		? {
				POSTGRES_USER: username,
				POSTGRES_PASSWORD: password,
				POSTGRES_DB: database,
			}
		: {
				MYSQL_USER: username,
				MYSQL_PASSWORD: password,
				MYSQL_DATABASE: database,
				MYSQL_ROOT_PASSWORD: randomBytes(24).toString("base64url"),
			};
	return {
		targetEnv: target.targetEnv,
		serviceEnv,
		serviceEnvKeys: Object.keys(serviceEnv),
	};
}

function bindingEnvironment(
	plan: RuntimeIsolationPlanV1,
	values: Record<string, string>,
) {
	return {
		targetEnv: Object.fromEntries(
			plan.database.bindings.map((binding) => [
				binding.key,
				values[binding.valueKind],
			]),
		),
		serviceEnv: {},
		serviceEnvKeys: [],
	};
}
