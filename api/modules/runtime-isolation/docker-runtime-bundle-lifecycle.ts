import { randomBytes, randomUUID } from "node:crypto";
import type { RuntimeIsolationPlanV1 } from "../../../shared/schemas/runtime-isolation.schema";
import {
	buildDatabaseArgs,
	buildNamespaceOwnerArgs,
	buildTargetArgs,
	cleanupRuntimeBundle,
	type PrivateRuntimeBundleChild,
	type PrivateRuntimeBundleReceipt,
	runtimeBundleLabels,
} from "./docker-runtime-bundle";
import type { RuntimeImageRegistry } from "./runtime-image-registry";
import {
	RuntimeDockerCommandError,
	RuntimeTargetPreparationError,
	type RuntimeBundlePhase,
	type RuntimeDockerOperation,
	type RuntimeFailureEvidence,
	type RuntimeFailureReasonCode,
	safeRuntimeText,
} from "./runtime-failure";

type RuntimeBundleLease = { id: string } | null;

export type RuntimeBundleLeaseRepository = {
	acquire(input: {
		scanRunId: string;
		stepId: string;
		resourceType: string;
		provider: string;
		externalId: string;
		receipt: Record<string, unknown>;
		leaseExpiresAt: Date;
	}): Promise<RuntimeBundleLease>;
	updateActiveReceipt(
		id: string,
		receipt: Record<string, unknown>,
	): Promise<unknown>;
	release(id: string, receipt: Record<string, unknown>): Promise<unknown>;
	quarantine(id: string, receipt: Record<string, unknown>): Promise<unknown>;
};

export type DockerRuntimeBundleRunner = {
	run(
		argv: string[],
		options?: { env?: Record<string, string> },
	): Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
		terminationReason?: string | null;
	}>;
};

export type StartedDockerRuntimeBundle = {
	leaseId: string;
	receipt: PrivateRuntimeBundleReceipt;
	origin: string;
	namespaceOwnerId: string;
	stop(): Promise<void>;
};

/**
 * Constructs an isolated local target only from a sanitized projection. The
 * runner deliberately receives DB values out-of-band, so passwords are never
 * included in command argv, receipts, labels, events, or execution plans.
 */
export async function startDockerRuntimeBundle(params: {
	scanRunId: string;
	projectionPath: string;
	plan: RuntimeIsolationPlanV1;
	planHash: string;
	images: RuntimeImageRegistry;
	leaseRepository: RuntimeBundleLeaseRepository;
	runner: DockerRuntimeBundleRunner;
	dockerBin?: string;
	leaseTtlMs?: number;
	readinessTimeoutMs?: number;
	stepId?: string;
}): Promise<StartedDockerRuntimeBundle> {
	const dockerBin = params.dockerBin ?? "docker";
	const bundleId = randomUUID();
	const prefix = `vwb-${bundleId}`;
	const receipt: PrivateRuntimeBundleReceipt = {
		bundleId,
		scanRunId: params.scanRunId,
		children: [],
	};
	const lease = await params.leaseRepository.acquire({
		scanRunId: params.scanRunId,
		stepId: "runtime-bundle",
		resourceType: "runtime_bundle",
		provider: "docker-runtime-isolation",
		externalId: `runtime-bundle:${bundleId}`,
		receipt: privateReceipt(receipt, params.planHash),
		leaseExpiresAt: new Date(Date.now() + (params.leaseTtlMs ?? 30 * 60_000)),
	});
	if (!lease) throw new Error("runtime_bundle_lease_acquisition_failed");

	const remember = async (child: PrivateRuntimeBundleChild) => {
		receipt.children.push(child);
		await params.leaseRepository.updateActiveReceipt(
			lease.id,
			privateReceipt(receipt, params.planHash),
		);
	};
	const execute = async (
		argv: string[],
		context: {
			phase: RuntimeBundlePhase;
			role: PrivateRuntimeBundleChild["role"] | null;
			operation: RuntimeDockerOperation;
			reasonCode?: RuntimeFailureReasonCode;
		} = {
			phase: "workspace",
			role: null,
			operation: "create",
		},
		options?: { env?: Record<string, string> },
	) => {
		const result = await params.runner.run(argv, options);
		if (
			result.exitCode !== 0 ||
			(argv[1] === "wait" && result.stdout.trim() !== "0")
		) {
			throw new RuntimeDockerCommandError({
				reasonCode:
					context.reasonCode ??
					(context.operation === "wait" && context.role === "probe"
						? "runtime_target_readiness_timeout"
						: context.role === "dependency-fetch"
							? "runtime_dependency_install_failed"
							: "runtime_container_create_failed"),
				phase: context.phase,
				role: context.role,
				operation: context.operation,
				exitCode: result.exitCode,
				terminationReason: result.terminationReason ?? null,
				stderr: result.stderr,
				stdout: result.stdout,
			});
		}
	};

	try {
		const workspaceVolume = `${prefix}-workspace`;
		await execute([
			dockerBin,
			"volume",
			"create",
			...runtimeBundleLabels({
				bundleId,
				scanRunId: params.scanRunId,
				role: "workspace-volume",
			}),
			workspaceVolume,
		]);
		await remember({
			role: "workspace-volume",
			kind: "volume",
			id: workspaceVolume,
		});
		const buildInternal = `${prefix}-build-internal`;
		await execute([
			dockerBin,
			"network",
			"create",
			"--internal",
			...runtimeBundleLabels({
				bundleId,
				scanRunId: params.scanRunId,
				role: "build-internal-network",
			}),
			buildInternal,
		]);
		await remember({
			role: "build-internal-network",
			kind: "network",
			id: buildInternal,
		});
		const buildEgress = `${prefix}-build-egress`;
		await execute([
			dockerBin,
			"network",
			"create",
			...runtimeBundleLabels({
				bundleId,
				scanRunId: params.scanRunId,
				role: "build-egress-network",
			}),
			buildEgress,
		]);
		await remember({
			role: "build-egress-network",
			kind: "network",
			id: buildEgress,
		});
		const registryProxy = `${prefix}-registry-proxy`;
		await execute([
			dockerBin,
			"create",
			"--name",
			registryProxy,
			"--network",
			buildEgress,
			"--user",
			"1000:1000",
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--memory",
			"256m",
			"--memory-swap",
			"256m",
			"--cpus",
			"0.5",
			"--pids-limit",
			"64",
			"--tmpfs",
			"/tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000",
			...runtimeBundleLabels({
				bundleId,
				scanRunId: params.scanRunId,
				role: "registry-proxy",
			}),
			params.images.registryProxy,
		]);
		await remember({
			role: "registry-proxy",
			kind: "container",
			id: registryProxy,
		});
		await execute([
			dockerBin,
			"network",
			"connect",
			buildInternal,
			registryProxy,
		]);
		await execute([dockerBin, "start", registryProxy]);

		const owner = `${prefix}-owner`;
		await execute(
			buildNamespaceOwnerArgs({
				dockerBin,
				name: owner,
				image: params.images.namespaceOwner,
				bundleId,
				scanRunId: params.scanRunId,
			}),
		);
		await remember({ role: "namespace-owner", kind: "container", id: owner });
		await execute([dockerBin, "start", owner]);

		const materializer = `${prefix}-materializer`;
		await execute(
			[
				dockerBin,
				"create",
				"--name",
				materializer,
				"--network",
				"none",
				"--user",
				"0:0",
				"--read-only",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--memory",
				"256m",
				"--memory-swap",
				"256m",
				"--cpus",
				"0.5",
				"--pids-limit",
				"64",
				"--mount",
				`type=bind,src=${params.projectionPath},dst=/source,readonly`,
				"--mount",
				`type=volume,src=${workspaceVolume},dst=/workspace,volume-nocopy`,
				...runtimeBundleLabels({
					bundleId,
					scanRunId: params.scanRunId,
					role: "materializer",
				}),
				params.images.materializer,
				"sh",
				"-ceu",
				"cp -a /source/. /workspace/; chmod -R a+rwX /workspace",
			],
			{
				phase: "workspace",
				role: "materializer",
				operation: "create",
				reasonCode: "runtime_bind_mount_unavailable",
			},
		);
		await remember({
			role: "materializer",
			kind: "container",
			id: materializer,
		});
		await execute([dockerBin, "start", materializer], {
			phase: "workspace",
			role: "materializer",
			operation: "start",
		});
		await execute([dockerBin, "wait", materializer], {
			phase: "workspace",
			role: "materializer",
			operation: "wait",
		});
		const dependencyFetch = `${prefix}-dependency-fetch`;
		const registryUrl = `http://${registryProxy}:4873`;
		const dependencyInstall = dependencyInstallCommand(
			params.plan,
			registryUrl,
		);
		await execute(
			[
				dockerBin,
				"create",
				"--name",
				dependencyFetch,
				"--network",
				buildInternal,
				"--user",
				"1000:1000",
				"--read-only",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--memory",
				"1g",
				"--memory-swap",
				"1g",
				"--cpus",
				"1",
				"--pids-limit",
				"256",
				"--tmpfs",
				"/runtime-home:rw,nosuid,nodev,size=256m,uid=1000,gid=1000",
				"--tmpfs",
				"/runtime-tmp:rw,nosuid,nodev,size=256m,uid=1000,gid=1000",
				"--mount",
				`type=volume,src=${workspaceVolume},dst=/workspace,volume-nocopy`,
				"--workdir",
				"/workspace",
				"--env",
				"HOME=/runtime-home",
				"--env",
				"TMPDIR=/runtime-tmp",
				"--env",
				`npm_config_registry=${registryUrl}`,
				"--env",
				"npm_config_ignore_scripts=true",
				"--env",
				"npm_config_audit=false",
				"--env",
				"npm_config_fund=false",
				"--env",
				`BUN_CONFIG_REGISTRY=${registryUrl}`,
				...runtimeBundleLabels({
					bundleId,
					scanRunId: params.scanRunId,
					role: "dependency-fetch",
				}),
				params.images.nodeRuntime,
				...dependencyInstall,
			],
			{
				phase: "dependency_install",
				role: "dependency-fetch",
				operation: "create",
				reasonCode: "runtime_dependency_install_failed",
			},
		);
		await remember({
			role: "dependency-fetch",
			kind: "container",
			id: dependencyFetch,
		});
		await execute([dockerBin, "start", dependencyFetch], {
			phase: "dependency_install",
			role: "dependency-fetch",
			operation: "start",
			reasonCode: "runtime_dependency_install_failed",
		});
		await execute([dockerBin, "wait", dependencyFetch], {
			phase: "dependency_install",
			role: "dependency-fetch",
			operation: "wait",
			reasonCode: "runtime_dependency_install_failed",
		});
		await execute([dockerBin, "stop", registryProxy]);

		const database = databaseEnvironment(params.plan);
		if (
			params.plan.database.mode === "postgres_ephemeral" ||
			params.plan.database.mode === "mysql_ephemeral"
		) {
			const image =
				params.plan.database.mode === "postgres_ephemeral"
					? params.images.postgres
					: params.images.mysql;
			if (!image) throw new Error("runtime_database_provider_unqualified");
			const databaseName = `${prefix}-database`;
			await execute(
				buildDatabaseArgs({
					dockerBin,
					name: databaseName,
					image,
					namespaceOwnerId: owner,
					bundleId,
					scanRunId: params.scanRunId,
					mode: params.plan.database.mode,
					envKeys: database.serviceEnvKeys,
				}),
				{ phase: "target_start", role: "database", operation: "create" },
				{ env: database.serviceEnv },
			);
			await remember({ role: "database", kind: "container", id: databaseName });
			await execute([dockerBin, "start", databaseName], {
				phase: "target_start",
				role: "database",
				operation: "start",
			});
			await execute(
				databaseReadinessArgs({
					dockerBin,
					containerName: databaseName,
					mode: params.plan.database.mode,
				}),
				{ phase: "target_start", role: "database", operation: "exec" },
			);
		}

		const target = `${prefix}-target`;
		await execute(
			buildTargetArgs({
				dockerBin,
				name: target,
				image: params.images.nodeRuntime,
				namespaceOwnerId: owner,
				workspaceVolume,
				bundleId,
				scanRunId: params.scanRunId,
				start: params.plan.start,
				envKeys: Object.keys(database.targetEnv),
			}),
			{ phase: "target_start", role: "target", operation: "create" },
			{ env: database.targetEnv },
		);
		await remember({ role: "target", kind: "container", id: target });
		await execute([dockerBin, "start", target], {
			phase: "target_start",
			role: "target",
			operation: "start",
		});
		const probe = `${prefix}-probe`;
		const readinessUrls = params.plan.start.readinessPaths.map(
			(readinessPath) =>
				`http://127.0.0.1:${params.plan.start.port}${readinessPath}`,
		);
		const readinessAttempts = Math.max(
			1,
			Math.floor((params.readinessTimeoutMs ?? 30_000) / 1_000),
		);
		await execute(
			[
				dockerBin,
				"create",
				"--name",
				probe,
				"--network",
				`container:${owner}`,
				"--user",
				"1000:1000",
				"--read-only",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--memory",
				"128m",
				"--memory-swap",
				"128m",
				"--cpus",
				"0.25",
				"--pids-limit",
				"32",
				"--tmpfs",
				"/tmp:rw,nosuid,nodev,size=32m,uid=1000,gid=1000",
				...runtimeBundleLabels({
					bundleId,
					scanRunId: params.scanRunId,
					role: "probe",
				}),
				params.images.probe,
				"node",
				"-e",
				`const urls=process.argv.slice(1);let attempt=0;const deadline=Date.now()+${params.readinessTimeoutMs ?? 30_000};const results=urls.map(()=>"connection_error");const probe=async()=>{for(const [index,url] of urls.entries()){const remaining=deadline-Date.now();if(remaining<=0)break;try{const response=await fetch(url,{method:"GET",redirect:"manual",signal:AbortSignal.timeout(Math.max(1,Math.min(5000,remaining)))});await response.body?.cancel();results[index]=\`http_\${response.status}\`;if(response.status>=100&&response.status<500)process.exit(0)}catch{results[index]="connection_error"}}attempt+=1;if(attempt>=${readinessAttempts}||Date.now()>=deadline){console.log(JSON.stringify({attempts:attempt,results}));process.exit(1)}setTimeout(probe,Math.min(1000,Math.max(0,deadline-Date.now())))};void probe()`,
				...readinessUrls,
			],
			{ phase: "readiness", role: "probe", operation: "create" },
		);
		await remember({ role: "probe", kind: "container", id: probe });
		await execute([dockerBin, "start", probe], {
			phase: "readiness",
			role: "probe",
			operation: "start",
		});
		await execute([dockerBin, "wait", probe], {
			phase: "readiness",
			role: "probe",
			operation: "wait",
			reasonCode: "runtime_target_readiness_timeout",
		});

		return {
			leaseId: lease.id,
			receipt,
			origin: `http://127.0.0.1:${params.plan.start.port}`,
			namespaceOwnerId: owner,
			stop: async () =>
				stopDockerRuntimeBundle({
					...params,
					dockerBin,
					leaseId: lease.id,
					receipt,
				}),
		};
	} catch (error) {
		const primary = RuntimeTargetPreparationError.fromUnknown(error);
		const evidence = await collectRuntimeFailureEvidence({
			runner: params.runner,
			dockerBin,
			receipt,
			stepId: params.stepId ?? "runtime-target",
			failure: primary,
			readinessTimeoutMs: params.readinessTimeoutMs ?? 30_000,
			readinessPaths: params.plan.start.readinessPaths,
		}).catch(() => null);
		let cleanupFailure: RuntimeDockerCommandError | null = null;
		try {
			await cleanupRuntimeBundle({ dockerBin, receipt, runner: params.runner });
			await params.leaseRepository.release(
				lease.id,
				privateReceipt(receipt, params.planHash),
			);
		} catch (cleanupError) {
			cleanupFailure =
				cleanupError instanceof RuntimeDockerCommandError
					? cleanupError
					: new RuntimeDockerCommandError({
							reasonCode: "runtime_cleanup_failed",
							phase: "cleanup",
							role: null,
							operation: "dispose",
							exitCode: null,
							terminationReason: null,
							stderr:
								cleanupError instanceof Error
									? cleanupError.message
									: String(cleanupError),
							stdout: "",
						});
			await params.leaseRepository
				.quarantine(lease.id, privateReceipt(receipt, params.planHash))
				.catch(() => undefined);
		}
		throw new RuntimeTargetPreparationError({
			...primary.input,
			evidence,
			cleanupFailure,
		});
	}
}

async function collectRuntimeFailureEvidence(params: {
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

function readReadinessEvidence(params: {
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

function databaseReadinessArgs(params: {
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

function dependencyInstallCommand(
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

async function stopDockerRuntimeBundle(params: {
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

function privateReceipt(
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

function databaseEnvironment(plan: RuntimeIsolationPlanV1): {
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
