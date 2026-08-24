import { describe, expect, test } from "bun:test";
import { SCAN_PROFILE_CATALOG } from "./profile-catalog";
import {
	assertScanProfileDefinitionIntegrity,
	getScanProfileDefinition,
	SCAN_PROFILE_DEFINITIONS,
} from "./profile-definitions";

describe("scan profile definitions", () => {
	test("covers every public catalog profile exactly once", () => {
		assertScanProfileDefinitionIntegrity();
		expect(SCAN_PROFILE_DEFINITIONS).toHaveLength(13);
		expect(new Set(SCAN_PROFILE_DEFINITIONS.map((entry) => entry.id)).size).toBe(13);
		expect(new Set(SCAN_PROFILE_CATALOG.map((entry) => entry.id))).toEqual(
			new Set(SCAN_PROFILE_DEFINITIONS.map((entry) => entry.id)),
		);
	});

	test("gives each variant immutable work and a qualification fixture", () => {
		for (const definition of SCAN_PROFILE_DEFINITIONS) {
			for (const variant of definition.variants) {
				expect(variant.stepIds.length).toBeGreaterThan(0);
				expect(variant.qualificationFixture).toStartWith(
					"scripts/scan-profile-qualification/fixtures/",
				);
			}
		}
	});

	test("resolves a canonical profile", () => {
		expect(getScanProfileDefinition("runtime-passive")).toMatchObject({
			engineId: "passive-runtime",
		});
	});

	test("probes only the selected supply-chain verifier", () => {
		const definition = getScanProfileDefinition("dependency-supply-chain");
		expect(
			definition.variants.find((variant) => variant.id === "offline-attestation")
				?.dependencyIds,
		).toContain("scanner.cosign");
		expect(
			definition.variants.find((variant) => variant.id === "slsa-provenance")
				?.dependencyIds,
		).toContain("scanner.slsa-verifier");
	});
});
