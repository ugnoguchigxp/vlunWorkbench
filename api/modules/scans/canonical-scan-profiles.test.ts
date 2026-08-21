import { describe, expect, test } from "bun:test";
import { buildCanonicalScanProfiles } from "./canonical-scan-profiles";
import { SOURCE_BASELINE_SCOPE } from "./profiles";

describe("canonical scan profiles", () => {
	test("provides strict source and change contracts without changing legacy IDs", () => {
		const profiles = buildCanonicalScanProfiles({
			sourceScope: SOURCE_BASELINE_SCOPE,
		});
		expect(profiles.map((profile) => profile.id)).toEqual([
			"change-gate",
			"source-assurance",
			"dependency-supply-chain",
		]);
		for (const profile of profiles) {
			expect(profile.strictness).toBe("strict");
			expect(profile.enabled).toBe(true);
		}
		const supplyChain = profiles.find(
			(profile) => profile.id === "dependency-supply-chain",
		);
		expect(supplyChain?.steps?.map((step) => step.kind)).toEqual([
			"static_tool",
			"sbom_export",
			"attestation_verify",
		]);
	});
});
