import { describe, expect, it } from "vitest";
import { classifyBoundReproduction } from "./reproduction-binding";

const binding = {
	sourceSnapshotDigest: "sha256:source",
	executionPlanHash: "sha256:plan",
	scannerBindingHash: "sha256:scanner",
};

describe("binding-aware reproduction", () => {
	it("maps reproduced to still_present and requires identical bindings for fixed", () => {
		expect(
			classifyBoundReproduction({ original: binding, observed: binding, observedOutcome: "reproduced" }),
		).toEqual({ outcome: "still_present", reasonCode: null });
		expect(
			classifyBoundReproduction({ original: binding, observed: binding, observedOutcome: "not_reproduced" }),
		).toEqual({ outcome: "fixed", reasonCode: null });
		expect(
			classifyBoundReproduction({
				original: binding,
				observed: { ...binding, executionPlanHash: "sha256:changed" },
				observedOutcome: "not_reproduced",
			}),
		).toEqual({ outcome: "inconclusive", reasonCode: "reproduction_binding_mismatch" });
	});
});
