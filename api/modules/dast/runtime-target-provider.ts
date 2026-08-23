import type { RuntimeIsolationPlanningResult } from "../runtime-isolation/runtime-isolation-planner";
import type { DastFetch } from "./http-runner";
import type {
	DastTargetStartPlan,
	PreparedDastTargetWorkspace,
} from "./target-preparer";

export type RuntimeScannerImages = Partial<
	Record<"nuclei-safe" | "zap-baseline" | "schemathesis", string>
>;

export type RuntimePreflightDockerImage = {
	role: string;
	stepId: string;
	image: string | null;
	required: boolean;
};

/** A prepared target used by profile steps without exposing host process startup. */
export type PreparedRuntimeTarget = Pick<
	PreparedDastTargetWorkspace,
	"origin" | "targetConfig" | "stop"
> & {
	plan: DastTargetStartPlan;
	evidence?: Record<string, unknown>;
	/** The provider owns the bundle lease and persists child receipts itself. */
	leaseManaged?: boolean;
	/** Opaque lifecycle-owned Docker namespace for runtime scanners. */
	runtimeNamespaceOwnerId?: string;
	runtimeScannerImages?: RuntimeScannerImages;
	runtimeDastFetch?: DastFetch;
};

export interface RuntimeTargetProvider {
	/** Preflight-visible contract for an injected isolated target. */
	plan?: DastTargetStartPlan;
	/** Immutable isolation inputs produced from the sanitized source projection. */
	runtimeIsolationPlanning?: RuntimeIsolationPlanningResult;
	/** Exact images that preflight must verify before this provider can run. */
	preflightDockerImages?: readonly RuntimePreflightDockerImage[];
	/** Scanner images used for version/data checks and eventual execution. */
	runtimeScannerImages?: RuntimeScannerImages;
	/** Releases a sanitized projection if preflight blocks before target start. */
	dispose?(): Promise<void>;
	prepare(input: {
		repoPath: string;
		readinessTimeoutMs: number;
		consentProjectCodeExecution: boolean;
	}): Promise<PreparedRuntimeTarget>;
}
