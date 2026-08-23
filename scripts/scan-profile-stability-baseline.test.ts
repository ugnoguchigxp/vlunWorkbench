import { describe, expect, test } from "bun:test";
import { SCAN_PROFILE_CATALOG } from "../api/modules/scans/profile-catalog";
import { buildScanProfileStabilityBaseline } from "./scan-profile-stability-baseline";

describe("scan profile stability baseline", () => {
	test("characterizes every catalog entry and the six experimental profiles", async () => {
		const baseline = await buildScanProfileStabilityBaseline({
			generatedAt: "2026-08-22T00:00:00.000Z",
			sourceRevision: "a".repeat(40),
		});

		expect(baseline.entries).toHaveLength(SCAN_PROFILE_CATALOG.length);
		expect(baseline.entries.map((entry) => entry.id)).toEqual(
			SCAN_PROFILE_CATALOG.map((entry) => entry.id),
		);
		expect(baseline.experimentalInventory.map((entry) => entry.profileId)).toEqual([
			"dynamic-verification",
			"authenticated-web",
			"api-readonly",
			"active-technical-lab",
			"business-logic-lab",
			"remediation-verification",
		]);
		for (const entry of baseline.entries) {
			expect(entry.entryHash).toMatch(/^sha256:[a-f0-9]{64}$/);
		}
		for (const entry of baseline.experimentalInventory) {
			expect(entry.executionEntry).toMatch(/^api\//);
			expect(entry.executionDefinition).toMatch(/^api\//);
			expect(entry.testPath).toMatch(/^api\//);
			expect(entry.knownLimitations).not.toHaveLength(0);
		}
	});
});
