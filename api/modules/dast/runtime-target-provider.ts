import type {
	DastTargetStartPlan,
	PreparedDastTargetWorkspace,
} from "./target-preparer";

/** A prepared target used by profile steps without exposing host process startup. */
export type PreparedRuntimeTarget = Pick<
	PreparedDastTargetWorkspace,
	"origin" | "targetConfig" | "stop"
> & {
	plan: DastTargetStartPlan;
	evidence?: Record<string, unknown>;
};

export interface RuntimeTargetProvider {
	/** Preflight-visible contract for an injected isolated target. */
	plan?: DastTargetStartPlan;
	prepare(input: {
		repoPath: string;
		readinessTimeoutMs: number;
		consentProjectCodeExecution: boolean;
	}): Promise<PreparedRuntimeTarget>;
}
