import type {
	RuntimeDatabaseMode,
	RuntimeIsolationPlanV1,
} from "../../../shared/schemas/runtime-isolation.schema";

export const RUNTIME_BUNDLE_LABEL_PREFIX = "com.vuln-workbench";

export type RuntimeBundleRole =
	| "namespace-owner"
	| "build-internal-network"
	| "build-egress-network"
	| "registry-proxy"
	| "dependency-fetch"
	| "materializer"
	| "dependency-volume"
	| "workspace-volume"
	| "database"
	| "target"
	| "probe"
	| "http-executor"
	| "scanner";

export type PrivateRuntimeBundleChild = {
	role: RuntimeBundleRole;
	kind: "container" | "volume" | "network";
	id: string;
};

export type PrivateRuntimeBundleReceipt = {
	bundleId: string;
	scanRunId: string;
	children: PrivateRuntimeBundleChild[];
};

export type DockerRuntimeImageRefs = {
	namespaceOwner: string;
	nodeRuntime: string;
	postgres?: string;
	mysql?: string;
};

export function runtimeBundleLabels(params: {
	bundleId: string;
	scanRunId: string;
	role: RuntimeBundleRole;
}): string[] {
	return [
		"--label",
		`${RUNTIME_BUNDLE_LABEL_PREFIX}.bundle=${params.bundleId}`,
		"--label",
		`${RUNTIME_BUNDLE_LABEL_PREFIX}.scan-run=${params.scanRunId}`,
		"--label",
		`${RUNTIME_BUNDLE_LABEL_PREFIX}.role=${params.role}`,
	];
}

export function buildNamespaceOwnerArgs(params: {
	dockerBin: string;
	name: string;
	image: string;
	bundleId: string;
	scanRunId: string;
}): string[] {
	return [
		params.dockerBin,
		"create",
		"--name",
		params.name,
		"--network",
		"none",
		"--user",
		"65532:65532",
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
		"64",
		...runtimeBundleLabels({ ...params, role: "namespace-owner" }),
		params.image,
		"sleep",
		"infinity",
	];
}

export function buildTargetArgs(params: {
	dockerBin: string;
	name: string;
	image: string;
	namespaceOwnerId: string;
	workspaceVolume: string;
	bundleId: string;
	scanRunId: string;
	start: RuntimeIsolationPlanV1["start"];
	envKeys: string[];
}): string[] {
	return [
		params.dockerBin,
		"create",
		"--name",
		params.name,
		"--network",
		`container:${params.namespaceOwnerId}`,
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
		"/runtime-home:rw,nosuid,nodev,size=128m,uid=1000,gid=1000",
		"--tmpfs",
		"/runtime-tmp:rw,nosuid,nodev,size=128m,uid=1000,gid=1000",
		"--tmpfs",
		"/runtime-data:rw,nosuid,nodev,size=512m,uid=1000,gid=1000",
		"--mount",
		`type=volume,src=${params.workspaceVolume},dst=/workspace,rw`,
		"--workdir",
		"/workspace",
		"--env",
		"HOME=/runtime-home",
		"--env",
		"TMPDIR=/runtime-tmp",
		"--env",
		"XDG_CACHE_HOME=/runtime-home/.cache",
		"--env",
		"CI=1",
		"--env",
		"NODE_ENV=test",
		"--env",
		"HOST=127.0.0.1",
		"--env",
		"PORT=18080",
		"--env",
		"VULN_WORKBENCH_EPHEMERAL_RUNTIME=1",
		...params.envKeys.flatMap((key) => ["--env", key]),
		...runtimeBundleLabels({ ...params, role: "target" }),
		params.image,
		"npm",
		...params.start.args,
	];
}

export function buildDatabaseArgs(params: {
	dockerBin: string;
	name: string;
	image: string;
	namespaceOwnerId: string;
	bundleId: string;
	scanRunId: string;
	mode: Exclude<RuntimeDatabaseMode, "none" | "sqlite_ephemeral">;
	envKeys: string[];
}): string[] {
	const databaseArgs =
		params.mode === "postgres_ephemeral"
			? ["postgres", "-c", "listen_addresses=127.0.0.1", "-p", "15432"]
			: ["mysqld", "--bind-address=127.0.0.1", "--port=13306"];
	const dataPath =
		params.mode === "postgres_ephemeral"
			? "/var/lib/postgresql/data"
			: "/var/lib/mysql";
	return [
		params.dockerBin,
		"create",
		"--name",
		params.name,
		"--network",
		`container:${params.namespaceOwnerId}`,
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
		`${dataPath}:rw,nosuid,nodev,size=512m`,
		...params.envKeys.flatMap((key) => ["--env", key]),
		...runtimeBundleLabels({ ...params, role: "database" }),
		params.image,
		...databaseArgs,
	];
}

export type DockerCommandRunner = {
	run(
		argv: string[],
	): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
};

export async function cleanupRuntimeBundle(params: {
	dockerBin: string;
	receipt: PrivateRuntimeBundleReceipt;
	runner: DockerCommandRunner;
}): Promise<void> {
	const order: Record<PrivateRuntimeBundleChild["kind"], number> = {
		container: 0,
		volume: 1,
		network: 2,
	};
	const children = [...params.receipt.children].sort(
		(left, right) => order[left.kind] - order[right.kind],
	);
	const failures: string[] = [];
	for (const child of children) {
		const argv =
			child.kind === "container"
				? [params.dockerBin, "rm", "-f", child.id]
				: child.kind === "volume"
					? [params.dockerBin, "volume", "rm", "-f", child.id]
					: [params.dockerBin, "network", "rm", child.id];
		const result = await params.runner.run(argv);
		if (result.exitCode !== 0) failures.push(`${child.kind}:${child.role}`);
	}
	if (failures.length > 0) {
		throw new Error(`runtime_bundle_cleanup_incomplete:${failures.join(",")}`);
	}
}
