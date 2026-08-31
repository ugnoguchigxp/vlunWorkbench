import { describe, expect, it } from "vitest";
import {
	PROFILE_STABILITY_POLICIES,
	validateProfileStabilityCases,
} from "./profile-stability-policy";

describe("profile stability policy", () => {
	it("requires every profile-specific case group", () => {
		expect(validateProfileStabilityCases("api-readonly", "api-readonly-stable-v1", ["openapi-3.0:fixed"])).toMatchObject({ ok: false, reason: "qualification_case_set_mismatch" });
		expect(validateProfileStabilityCases("api-readonly", "dynamic-verification-stable-v1", [])).toEqual({ ok: false, reason: "qualification_policy_mismatch" });
		const required = PROFILE_STABILITY_POLICIES["api-readonly-stable-v1"].requiredCaseIds;
		expect(validateProfileStabilityCases("api-readonly", "api-readonly-stable-v1", required)).toEqual({ ok: true });
		expect(validateProfileStabilityCases("api-readonly", "api-readonly-stable-v1", [...required, "unexpected"])).toMatchObject({ ok: false, unexpected: ["unexpected"] });
	});
});
