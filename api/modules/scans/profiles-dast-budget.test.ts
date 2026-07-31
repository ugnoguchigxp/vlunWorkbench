import { describe, expect, it } from "vitest";
import {
	listProfiles,
	plannedRuntimeAssessmentRequests,
	RUNTIME_ASSESSMENT_AGGREGATE_REQUEST_BUDGET,
} from "./profiles";

describe("standard runtime assessment request budget", () => {
	it("keeps every enabled profile within the aggregate policy", () => {
		for (const profile of listProfiles()) {
			expect(
				plannedRuntimeAssessmentRequests(profile),
				profile.id,
			).toBeLessThanOrEqual(RUNTIME_ASSESSMENT_AGGREGATE_REQUEST_BUDGET);
		}
		const full = listProfiles().find(
			(profile) => profile.id === "full-security-scan",
		);
		expect(full).toBeDefined();
		expect(plannedRuntimeAssessmentRequests(full!)).toBe(250);
	});
});
