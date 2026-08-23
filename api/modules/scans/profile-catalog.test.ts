import { describe, expect, test } from "bun:test";
import {
	getLegacyProfileAssociation,
	listGenericStartCatalogProfileIds,
	listPublicCatalogEntries,
	SCAN_PROFILE_LEGACY_ASSOCIATIONS,
	validateScanProfileCatalog,
} from "./profile-catalog";

describe("scan profile catalog", () => {
	test("has 14 canonical entries and maps all legacy definitions", () => {
		validateScanProfileCatalog();
		expect(listPublicCatalogEntries()).toHaveLength(14);
		expect(SCAN_PROFILE_LEGACY_ASSOCIATIONS).toHaveLength(23);
		expect(getLegacyProfileAssociation("runtime-zap-active-lab")).toEqual(
			expect.objectContaining({ canonicalProfileId: "active-technical-lab" }),
		);
		expect(listGenericStartCatalogProfileIds()).toEqual([
			"change-gate",
			"source-assurance",
			"runtime-passive",
		]);
	});

	test("keeps canonical defaults in the generic launcher", () => {
		for (const profileId of ["source-assurance", "change-gate"]) {
			expect(listGenericStartCatalogProfileIds()).toContain(profileId);
		}
	});
});
