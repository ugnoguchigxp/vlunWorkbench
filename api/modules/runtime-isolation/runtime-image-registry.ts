import type { QualifiedRuntimeImages } from "./runtime-isolation-planner";

export type RuntimeImageRegistry = {
	namespaceOwner: string;
	nodeRuntime: string;
	materializer: string;
	registryProxy: string;
	probe: string;
	httpExecutor: string;
	postgres?: string;
	mysql?: string;
	nuclei?: string;
	zap?: string;
	schemathesis?: string;
};

const REQUIRED_KEYS = [
	"VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE",
	"VULN_WORKBENCH_RUNTIME_NODE_IMAGE",
	"VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE",
	"VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE",
	"VULN_WORKBENCH_RUNTIME_PROBE_IMAGE",
	"VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE",
] as const;

export function loadRuntimeImageRegistry(
	env: Record<string, string | undefined> = process.env,
): RuntimeImageRegistry | null {
	if (REQUIRED_KEYS.some((key) => !isDigestImageRef(env[key]))) return null;
	const registry: RuntimeImageRegistry = {
		namespaceOwner: requiredImage(
			env,
			"VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE",
		),
		nodeRuntime: requiredImage(env, "VULN_WORKBENCH_RUNTIME_NODE_IMAGE"),
		materializer: requiredImage(
			env,
			"VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE",
		),
		registryProxy: requiredImage(
			env,
			"VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE",
		),
		probe: requiredImage(env, "VULN_WORKBENCH_RUNTIME_PROBE_IMAGE"),
		httpExecutor: requiredImage(
			env,
			"VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE",
		),
	};
	for (const [key, field] of [
		["VULN_WORKBENCH_RUNTIME_POSTGRES_IMAGE", "postgres"],
		["VULN_WORKBENCH_RUNTIME_MYSQL_IMAGE", "mysql"],
		["VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE", "nuclei"],
		["VULN_WORKBENCH_RUNTIME_ZAP_IMAGE", "zap"],
		["VULN_WORKBENCH_RUNTIME_SCHEMATHESIS_IMAGE", "schemathesis"],
	] as const) {
		const value = env[key];
		if (value === undefined) continue;
		if (!isDigestImageRef(value)) return null;
		registry[field] = value;
	}
	return registry;
}

export function runtimePlanImages(
	registry: RuntimeImageRegistry,
): QualifiedRuntimeImages {
	return {
		namespaceOwnerImageDigest: digestFromImageRef(registry.namespaceOwner),
		nodeRuntimeImageDigest: digestFromImageRef(registry.nodeRuntime),
		materializerImageDigest: digestFromImageRef(registry.materializer),
		registryProxyImageDigest: digestFromImageRef(registry.registryProxy),
		probeImageDigest: digestFromImageRef(registry.probe),
		httpExecutorImageDigest: digestFromImageRef(registry.httpExecutor),
		scannerImageDigests: Object.fromEntries(
			[
				["nuclei", registry.nuclei],
				["zap", registry.zap],
				["schemathesis", registry.schemathesis],
			]
				.filter((entry): entry is [string, string] => Boolean(entry[1]))
				.map(([role, ref]) => [role, digestFromImageRef(ref)]),
		),
		databaseImageDigests: {
			...(registry.postgres
				? { postgres_ephemeral: digestFromImageRef(registry.postgres) }
				: {}),
			...(registry.mysql
				? { mysql_ephemeral: digestFromImageRef(registry.mysql) }
				: {}),
		},
	};
}

export function digestFromImageRef(image: string): string {
	const digest = image.slice(image.lastIndexOf("@") + 1);
	if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
		throw new Error("runtime_image_digest_invalid");
	}
	return digest;
}

function isDigestImageRef(value: string | undefined): value is string {
	return Boolean(value && /^[^\s@]+@sha256:[a-f0-9]{64}$/.test(value));
}

function requiredImage(
	env: Record<string, string | undefined>,
	key: (typeof REQUIRED_KEYS)[number],
): string {
	const value = env[key];
	if (!isDigestImageRef(value))
		throw new Error("runtime_image_registry_invalid");
	return value;
}
