import { describe, expect, it } from "vitest";
import { assertDifferentialAuthReadiness } from "./auth-readiness";

describe("differential auth readiness", () => {
	it("requires an authenticated response that differs from the anonymous response", () => {
		expect(() => assertDifferentialAuthReadiness({ unauthenticatedStatus: 401, authenticatedStatus: 200, unauthenticatedDigest: "a", authenticatedDigest: "b" })).not.toThrow();
		expect(() => assertDifferentialAuthReadiness({ unauthenticatedStatus: 200, authenticatedStatus: 200, unauthenticatedDigest: "a", authenticatedDigest: "a" })).toThrow("authentication_assertion_required");
	});
});
