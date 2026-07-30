import { describe, expect, it } from "vitest";
import {
	legacyOutcomeToObservation,
	verificationResultSchema,
} from "./verification.schema";

describe("verification schema", () => {
	it("separates scanner observation from exploit reproduction", () => {
		expect(
			verificationResultSchema.safeParse({
				kind: "scanner_recheck",
				outcome: "observed",
				evidenceStrength: "scanner_signal",
				evidenceRefs: ["artifact:a"],
			}).success,
		).toBe(true);
		expect(
			verificationResultSchema.safeParse({
				kind: "scanner_recheck",
				outcome: "reproduced",
				evidenceStrength: "impact_demonstrated",
				evidenceRefs: ["artifact:a"],
			}).success,
		).toBe(false);
	});

	it("maps legacy scanner re-run outcomes without claiming exploit impact", () => {
		expect(legacyOutcomeToObservation("reproduced")).toBe("observed");
		expect(legacyOutcomeToObservation("not_reproduced")).toBe("not_observed");
	});
});
