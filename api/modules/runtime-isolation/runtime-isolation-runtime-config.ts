import type { AppEnv } from "../../app/env";
import {
	type RuntimeIsolationSettings,
	RuntimeIsolationSettingsSchema,
	normalizeLegacyLocalRuntimeImageReferences,
	runtimeIsolationSettingsFromBootstrap,
} from "../../config/runtime-settings";
import type { AppDatabase } from "../../db";
import { inferDastTargetStartPlan } from "../dast/target-preparer";
import { ScanResourceLeaseRepository } from "../scans/execution/lifecycle/scan-resource-lease-repository";
import { createDockerRuntimeCommandRunner } from "./docker-runtime-command-runner";
import { loadRuntimeImageRegistry } from "./runtime-image-registry";
import { createRuntimeIsolationProviderFactory } from "./runtime-isolation-provider-factory";

const NPM_ADAPTER = "npm-package-lock-v1" as const;
const BUN_ADAPTER = "bun-lock-v1" as const;

const digest = /^sha256:[a-f0-9]{64}$/;

/**
 * Reads only server-owned runtime configuration. Null means no isolated
 * runtime is available; callers must leave runtime profiles fail-closed.
 */
export function loadRuntimeIsolationProviderFactory(params: {
	db: AppDatabase;
	settings?: RuntimeIsolationSettings;
	/** Legacy bootstrap fallback; SQLite runtime settings should be preferred. */
	env?: Record<string, string | undefined>;
}) {
	const env = params.env ?? process.env;
	const parsedSettings = RuntimeIsolationSettingsSchema.safeParse(
		params.settings ?? runtimeIsolationSettingsFromEnvironment(env),
	);
	if (!parsedSettings.success) return null;
	const settings = normalizeLegacyLocalRuntimeImageReferences(
		parsedSettings.data,
	);
	const images = loadRuntimeImageRegistry(runtimeImageEnvironment(settings));
	const dockerDaemonIdentityHash = settings.dockerDaemonIdentityHash;
	const qualificationHash = settings.qualificationHash;
	if (
		!images ||
		!isRuntimeDigest(dockerDaemonIdentityHash) ||
		!isRuntimeDigest(qualificationHash)
	) {
		return null;
	}
	return createRuntimeIsolationProviderFactory({
		images,
		dockerDaemonIdentityHash,
		qualificationHash,
		qualifiedDependencyAdapterIds:
			settings.qualificationVersion >= 2
				? [NPM_ADAPTER, BUN_ADAPTER]
				: [NPM_ADAPTER],
		inferTargetPlan: inferDastTargetStartPlan,
		leaseRepository: new ScanResourceLeaseRepository(params.db),
		runner: createDockerRuntimeCommandRunner(),
		dockerBin: env.VULN_WORKBENCH_DOCKER_BIN,
	});
}

export function runtimeIsolationSettingsFromAppEnv(
	env: Pick<AppEnv, "runtimeIsolation">,
): RuntimeIsolationSettings {
	return runtimeIsolationSettingsFromBootstrap(env.runtimeIsolation);
}

function runtimeIsolationSettingsFromEnvironment(
	env: Record<string, string | undefined>,
): Record<string, string | number> {
	return {
		qualificationVersion: 1,
		namespaceOwnerImage: env.VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE ?? "",
		nodeImage: env.VULN_WORKBENCH_RUNTIME_NODE_IMAGE ?? "",
		materializerImage: env.VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE ?? "",
		registryProxyImage: env.VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE ?? "",
		probeImage: env.VULN_WORKBENCH_RUNTIME_PROBE_IMAGE ?? "",
		httpExecutorImage: env.VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE ?? "",
		dockerDaemonIdentityHash:
			env.VULN_WORKBENCH_RUNTIME_DOCKER_DAEMON_IDENTITY_HASH ?? "",
		qualificationHash: env.VULN_WORKBENCH_RUNTIME_QUALIFICATION_HASH ?? "",
		postgresImage: env.VULN_WORKBENCH_RUNTIME_POSTGRES_IMAGE ?? "",
		mysqlImage: env.VULN_WORKBENCH_RUNTIME_MYSQL_IMAGE ?? "",
		nucleiImage: env.VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE ?? "",
		zapImage: env.VULN_WORKBENCH_RUNTIME_ZAP_IMAGE ?? "",
		schemathesisImage: env.VULN_WORKBENCH_RUNTIME_SCHEMATHESIS_IMAGE ?? "",
	};
}

function runtimeImageEnvironment(
	settings: RuntimeIsolationSettings,
): Record<string, string | undefined> {
	return {
		VULN_WORKBENCH_RUNTIME_NAMESPACE_OWNER_IMAGE:
			settings.namespaceOwnerImage || undefined,
		VULN_WORKBENCH_RUNTIME_NODE_IMAGE: settings.nodeImage || undefined,
		VULN_WORKBENCH_RUNTIME_MATERIALIZER_IMAGE:
			settings.materializerImage || undefined,
		VULN_WORKBENCH_RUNTIME_REGISTRY_PROXY_IMAGE:
			settings.registryProxyImage || undefined,
		VULN_WORKBENCH_RUNTIME_PROBE_IMAGE: settings.probeImage || undefined,
		VULN_WORKBENCH_RUNTIME_HTTP_EXECUTOR_IMAGE:
			settings.httpExecutorImage || undefined,
		VULN_WORKBENCH_RUNTIME_POSTGRES_IMAGE: settings.postgresImage || undefined,
		VULN_WORKBENCH_RUNTIME_MYSQL_IMAGE: settings.mysqlImage || undefined,
		VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE: settings.nucleiImage || undefined,
		VULN_WORKBENCH_RUNTIME_ZAP_IMAGE: settings.zapImage || undefined,
		VULN_WORKBENCH_RUNTIME_SCHEMATHESIS_IMAGE:
			settings.schemathesisImage || undefined,
	};
}

function isRuntimeDigest(value: string | undefined): value is string {
	return Boolean(value && digest.test(value));
}
