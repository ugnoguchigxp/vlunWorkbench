import type { AppDatabase } from "../../db";
import { inferDastTargetStartPlan } from "../dast/target-preparer";
import { ScanResourceLeaseRepository } from "../scans/execution/lifecycle/scan-resource-lease-repository";
import { createDockerRuntimeCommandRunner } from "./docker-runtime-command-runner";
import { loadRuntimeImageRegistry } from "./runtime-image-registry";
import { createRuntimeIsolationProviderFactory } from "./runtime-isolation-provider-factory";

const digest = /^sha256:[a-f0-9]{64}$/;

/**
 * Reads only server-owned runtime configuration. Null means no isolated
 * runtime is available; callers must leave runtime profiles fail-closed.
 */
export function loadRuntimeIsolationProviderFactory(params: {
	db: AppDatabase;
	env?: Record<string, string | undefined>;
}) {
	const env = params.env ?? process.env;
	const images = loadRuntimeImageRegistry(env);
	const dockerDaemonIdentityHash =
		env.VULN_WORKBENCH_RUNTIME_DOCKER_DAEMON_IDENTITY_HASH;
	const qualificationHash = env.VULN_WORKBENCH_RUNTIME_QUALIFICATION_HASH;
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
		inferTargetPlan: inferDastTargetStartPlan,
		leaseRepository: new ScanResourceLeaseRepository(params.db),
		runner: createDockerRuntimeCommandRunner(),
		dockerBin: env.VULN_WORKBENCH_DOCKER_BIN,
	});
}

function isRuntimeDigest(value: string | undefined): value is string {
	return Boolean(value && digest.test(value));
}
