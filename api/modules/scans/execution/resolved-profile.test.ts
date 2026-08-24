import { describe, expect, it } from "vitest";
import { buildScanProfiles } from "../profiles";
import {
  hashResolvedProfile,
  readStoredResolvedProfile,
} from "./resolved-profile";

describe("stored resolved scan profiles", () => {
  it("binds optional Semgrep enablement into the resolved profile", () => {
    const withoutSemgrep = buildScanProfiles({ optionalAdapterIds: [] }).find(
      (profile) => profile.id === "full-security-scan",
    )!;
    const withSemgrep = buildScanProfiles({
      optionalAdapterIds: ["semgrep"],
    }).find((profile) => profile.id === "full-security-scan")!;
    expect(hashResolvedProfile(withoutSemgrep)).not.toBe(
      hashResolvedProfile(withSemgrep),
    );
    const stored = readStoredResolvedProfile(
      { resolvedProfile: withoutSemgrep },
      "full-security-scan",
    );
    expect(stored?.coverageGaps).toContain(
      "source_sast_adapter_not_available",
    );
    expect(stored?.capabilityRequirements).toContainEqual({
      capabilityId: "source_sast",
      requirement: "advisory",
    });
		expect(withSemgrep.tools).toContainEqual(
			expect.objectContaining({
				toolId: "semgrep",
				required: false,
				failurePolicy: "warn_and_continue",
			}),
		);
  });

  it("rejects a stored profile with the wrong id", () => {
    const profile = buildScanProfiles({ optionalAdapterIds: [] })[0]!;
    expect(
      readStoredResolvedProfile(
        { resolvedProfile: profile },
        "full-security-scan",
      ),
    ).toBeNull();
  });
});
