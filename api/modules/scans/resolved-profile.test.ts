import { describe, expect, it } from "vitest";
import { buildScanProfiles } from "./profiles";
import { hashResolvedProfile, readStoredResolvedProfile } from "./resolved-profile";

describe("stored resolved scan profiles", () => {
	it("keeps the exact adapter-dependent profile used by a scan", () => {
		const withoutSemgrep = buildScanProfiles({ optionalAdapterIds: [] }).find(
			(profile) => profile.id === "full-security-scan",
		)!;
		const withSemgrep = buildScanProfiles({
			optionalAdapterIds: ["semgrep"],
		}).find((profile) => profile.id === "full-security-scan")!;
		expect(hashResolvedProfile(withoutSemgrep)).not.toBe(
			hashResolvedProfile(withSemgrep),
		);
		expect(
			readStoredResolvedProfile(
				{ resolvedProfile: withoutSemgrep },
				"full-security-scan",
			)?.coverageGaps,
		).toEqual(["source_sast_not_executed"]);
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
