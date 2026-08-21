import type { ReproductionBindingContract } from "../../../shared/schemas/reproduction-binding.schema";

export type ReproductionBinding = ReproductionBindingContract;

/** A negative recheck means fixed only when all original execution bindings match. */
export function classifyBoundReproduction(params: {
	original: ReproductionBinding;
	observed: ReproductionBinding;
	observedOutcome: "reproduced" | "not_reproduced" | "inconclusive" | "error";
}): {
	outcome: "still_present" | "fixed" | "inconclusive" | "error";
	reasonCode: string | null;
} {
	if (params.observedOutcome === "reproduced") {
		return { outcome: "still_present", reasonCode: null };
	}
	if (params.observedOutcome === "error") {
		return { outcome: "error", reasonCode: "reproduction_execution_failed" };
	}
	if (params.observedOutcome === "inconclusive") {
		return { outcome: "inconclusive", reasonCode: "reproduction_inconclusive" };
	}
	const bindingMatches =
		params.original.sourceSnapshotDigest ===
			params.observed.sourceSnapshotDigest &&
		params.original.executionPlanHash === params.observed.executionPlanHash &&
		params.original.scannerBindingHash === params.observed.scannerBindingHash;
	return bindingMatches
		? { outcome: "fixed", reasonCode: null }
		: { outcome: "inconclusive", reasonCode: "reproduction_binding_mismatch" };
}
