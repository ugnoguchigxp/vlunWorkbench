import type {
	PreparedRuntimeTarget,
	RuntimeTargetProvider,
} from "../../dast/runtime-target-provider";

export type SharedRuntimeTarget = PreparedRuntimeTarget;

export async function prepareSharedRuntimeTarget(params: {
	repoPath: string;
	consentProjectCodeExecution: boolean;
	runtimeTargetProvider?: RuntimeTargetProvider;
}): Promise<SharedRuntimeTarget> {
	if (params.runtimeTargetProvider) {
		return params.runtimeTargetProvider.prepare({
			repoPath: params.repoPath,
			readinessTimeoutMs: 30_000,
			consentProjectCodeExecution: params.consentProjectCodeExecution,
		});
	}
	throw new Error("runtime_isolation_provider_unavailable");
}
