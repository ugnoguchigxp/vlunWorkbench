import { describe, expect, it } from "vitest";
import {
	admitDedicatedProfile,
	buildDedicatedProfileAdmissionMetadata,
} from "./dedicated-profile-admission";

describe("dedicated profile admission", () => {
	it("requires catalog inputs and the catalog-owned destination before a run exists", () => {
		expect(() => admitDedicatedProfile({ canonicalProfileId: "dynamic-verification", expectedLaunchDestination: "dast_workspace", providedInputKinds: ["source_target", "execution_consent"] })).toThrow("profile_destination_mismatch");
		expect(() => admitDedicatedProfile({ canonicalProfileId: "dynamic-verification", expectedLaunchDestination: "dynamic_workspace", providedInputKinds: ["source_target"] })).toThrow("Missing dedicated profile inputs");
		expect(admitDedicatedProfile({ canonicalProfileId: "dynamic-verification", expectedLaunchDestination: "dynamic_workspace", providedInputKinds: ["source_target", "execution_consent"] })).toMatchObject({ profileId: "dynamic-verification", safetyClass: "R1" });
	});

	it("adds an authoritative profile-derived progress inventory", () => {
		const metadata = buildDedicatedProfileAdmissionMetadata({
			canonicalProfileId: "authenticated-web",
			expectedLaunchDestination: "dast_workspace",
			providedInputKinds: ["runtime_target", "auth_context_ref"],
		});
		expect(metadata.queuedProgressSteps).toEqual([
			expect.objectContaining({
				stepId: "auth:session",
				kind: "runtime_scanner",
				required: true,
			}),
			expect.objectContaining({
				stepId: "dast:authenticated-readonly-standard",
			}),
		]);
	});
});
