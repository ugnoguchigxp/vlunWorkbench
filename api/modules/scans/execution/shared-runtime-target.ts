import type {
	PreparedRuntimeTarget,
	RuntimeTargetProvider,
} from "../../dast/runtime-target-provider";
import { prepareDastTargetWorkspace } from "../../dast/target-preparer";

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
	return prepareDastTargetWorkspace({
		repoPath: params.repoPath,
		consentProjectCodeExecution: params.consentProjectCodeExecution,
	});
}
