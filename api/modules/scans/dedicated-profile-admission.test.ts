import { describe, expect, it } from "vitest";
import { admitDedicatedProfile } from "./dedicated-profile-admission";

describe("dedicated profile admission", () => {
	it("requires catalog inputs and the catalog-owned destination before a run exists", () => {
		expect(() => admitDedicatedProfile({ canonicalProfileId: "dynamic-verification", expectedLaunchDestination: "dast_workspace", providedInputKinds: ["source_target", "execution_consent"] })).toThrow("profile_destination_mismatch");
		expect(() => admitDedicatedProfile({ canonicalProfileId: "dynamic-verification", expectedLaunchDestination: "dynamic_workspace", providedInputKinds: ["source_target"] })).toThrow("Missing dedicated profile inputs");
		expect(admitDedicatedProfile({ canonicalProfileId: "dynamic-verification", expectedLaunchDestination: "dynamic_workspace", providedInputKinds: ["source_target", "execution_consent"] })).toMatchObject({ profileId: "dynamic-verification", safetyClass: "R1" });
	});
});
