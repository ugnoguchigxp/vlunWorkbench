import type {
	PreparedRuntimeTarget,
	RuntimeTargetProvider,
} from "../../dast/runtime-target-provider";
import { RuntimeTargetPreparationError } from "../../runtime-isolation/runtime-failure";

export type SharedRuntimeTarget = PreparedRuntimeTarget;

export type RuntimeTargetSessionState =
	| "idle"
	| "preparing"
	| "ready"
	| "failed"
	| "disposed";

/**
 * Owns exactly one target preparation attempt per profile run. A failed
 * preparation is a shared dependency failure, not a reason to start fresh
 * Docker bundles for every downstream scanner.
 */
export class RuntimeTargetSession {
	private state: RuntimeTargetSessionState = "idle";
	private preparation: Promise<SharedRuntimeTarget> | null = null;
	private target: SharedRuntimeTarget | null = null;
	private failure: RuntimeTargetPreparationError | null = null;
	private disposed = false;

	constructor(
		private readonly params: {
			repoPath: string;
			consentProjectCodeExecution: boolean;
			runtimeTargetProvider?: RuntimeTargetProvider;
			readinessTimeoutMs?: number;
		},
	) {}

	getState(): RuntimeTargetSessionState {
		return this.state;
	}

	getFailure(): RuntimeTargetPreparationError | null {
		return this.failure;
	}

	async ensure(): Promise<SharedRuntimeTarget> {
		if (this.disposed) {
			throw new RuntimeTargetPreparationError({
				reasonCode: "runtime_target_session_disposed",
				phase: "cleanup",
				role: null,
				operation: "dispose",
				exitCode: null,
				terminationReason: null,
				safeExcerpt: "Runtime target session has already been disposed.",
			});
		}
		if (this.target) return this.target;
		if (this.failure) throw this.failure;
		if (!this.preparation) {
			this.state = "preparing";
			this.preparation = prepareSharedRuntimeTarget({
				...this.params,
				readinessTimeoutMs: this.params.readinessTimeoutMs ?? 30_000,
			}).then(
				(target) => {
					this.target = target;
					this.state = "ready";
					return target;
				},
				(error: unknown) => {
					this.failure = RuntimeTargetPreparationError.fromUnknown(error);
					this.state = "failed";
					throw this.failure;
				},
			);
		}
		return await this.preparation;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.state = "disposed";
		await this.target?.stop();
	}
}

export async function prepareSharedRuntimeTarget(params: {
	repoPath: string;
	consentProjectCodeExecution: boolean;
	runtimeTargetProvider?: RuntimeTargetProvider;
	readinessTimeoutMs?: number;
}): Promise<SharedRuntimeTarget> {
	if (params.runtimeTargetProvider) {
		return params.runtimeTargetProvider.prepare({
			repoPath: params.repoPath,
			readinessTimeoutMs: params.readinessTimeoutMs ?? 30_000,
			consentProjectCodeExecution: params.consentProjectCodeExecution,
		});
	}
	throw new Error("runtime_isolation_provider_unavailable");
}
