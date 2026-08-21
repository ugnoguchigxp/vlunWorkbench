import { randomBytes, randomUUID } from "node:crypto";
import type { RuntimeIsolationPlanV1 } from "../../../shared/schemas/runtime-isolation.schema";
import type { RuntimeImageRegistry } from "./runtime-image-registry";
import {
	buildDatabaseArgs,
	buildNamespaceOwnerArgs,
	buildTargetArgs,
	cleanupRuntimeBundle,
	runtimeBundleLabels,
	type PrivateRuntimeBundleChild,
	type PrivateRuntimeBundleReceipt,
} from "./docker-runtime-bundle";

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
	): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
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
		options?: { env?: Record<string, string> },
	) => {
		const result = await params.runner.run(argv, options);
		if (
			result.exitCode !== 0 ||
			(argv[1] === "wait" && result.stdout.trim() !== "0")
		) {
			throw new Error(
				`runtime_bundle_docker_command_failed:${argv[1] ?? "unknown"}`,
			);
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
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--tmpfs",
			"/tmp:rw,nosuid,nodev,size=128m",
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
		await execute([
			dockerBin,
			"create",
			"--name",
			materializer,
			"--network",
			"none",
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--mount",
			`type=bind,src=${params.projectionPath},dst=/source,readonly`,
			"--mount",
			`type=volume,src=${workspaceVolume},dst=/workspace,rw`,
			...runtimeBundleLabels({
				bundleId,
				scanRunId: params.scanRunId,
				role: "materializer",
			}),
			params.images.materializer,
			"sh",
			"-ceu",
			"cp -a /source/. /workspace/; chmod -R a+rwX /workspace",
		]);
		await remember({
			role: "materializer",
			kind: "container",
			id: materializer,
		});
		await execute([dockerBin, "start", materializer]);
		await execute([dockerBin, "wait", materializer]);
		const dependencyFetch = `${prefix}-dependency-fetch`;
		await execute([
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
			"--tmpfs",
			"/runtime-home:rw,nosuid,nodev,size=256m,uid=1000,gid=1000",
			"--tmpfs",
			"/runtime-tmp:rw,nosuid,nodev,size=256m,uid=1000,gid=1000",
			"--mount",
			`type=volume,src=${workspaceVolume},dst=/workspace,rw`,
			"--workdir",
			"/workspace",
			"--env",
			"HOME=/runtime-home",
			"--env",
			"TMPDIR=/runtime-tmp",
			"--env",
			`npm_config_registry=http://${registryProxy}:4873`,
			"--env",
			"npm_config_ignore_scripts=true",
			"--env",
			"npm_config_audit=false",
			"--env",
			"npm_config_fund=false",
			...runtimeBundleLabels({
				bundleId,
				scanRunId: params.scanRunId,
				role: "dependency-fetch",
			}),
			params.images.nodeRuntime,
			"npm",
			"ci",
			"--ignore-scripts",
			"--audit=false",
			"--fund=false",
		]);
		await remember({
			role: "dependency-fetch",
			kind: "container",
			id: dependencyFetch,
		});
		await execute([dockerBin, "start", dependencyFetch]);
		await execute([dockerBin, "wait", dependencyFetch]);

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
				{ env: database.serviceEnv },
			);
			await remember({ role: "database", kind: "container", id: databaseName });
			await execute([dockerBin, "start", databaseName]);
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
			{ env: database.targetEnv },
		);
		await remember({ role: "target", kind: "container", id: target });
		await execute([dockerBin, "start", target]);
		const probe = `${prefix}-probe`;
		const readinessPath = params.plan.start.readinessPaths[0] ?? "/";
		await execute([
			dockerBin,
			"create",
			"--name",
			probe,
			"--network",
			`container:${owner}`,
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--tmpfs",
			"/tmp:rw,nosuid,nodev,size=32m",
			...runtimeBundleLabels({
				bundleId,
				scanRunId: params.scanRunId,
				role: "probe",
			}),
			params.images.probe,
			"wget",
			"-q",
			"-T",
			"10",
			"-O",
			"/dev/null",
			`http://127.0.0.1:${params.plan.start.port}${readinessPath}`,
		]);
		await remember({ role: "probe", kind: "container", id: probe });
		await execute([dockerBin, "start", probe]);
		await execute([dockerBin, "wait", probe]);

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
		try {
			await cleanupRuntimeBundle({ dockerBin, receipt, runner: params.runner });
			await params.leaseRepository.release(
				lease.id,
				privateReceipt(receipt, params.planHash),
			);
		} catch {
			await params.leaseRepository.quarantine(
				lease.id,
				privateReceipt(receipt, params.planHash),
			);
		}
		throw error;
	}
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
