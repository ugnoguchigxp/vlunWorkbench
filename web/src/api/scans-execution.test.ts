import { describe, expect, it } from "vitest";
import {
	type ScanProfileCatalogEntry,
	type ScanProfileCatalogResponse,
	toLaunchableScanProfiles,
} from "./scans-execution";

const profileIds = [
	"change-gate",
	"source-assurance",
	"dependency-supply-chain",
	"release-artifact",
	"dynamic-verification",
	"runtime-passive",
	"authenticated-web",
	"api-readonly",
	"active-technical-lab",
	"business-logic-lab",
	"remediation-verification",
	"professional-full",
] as const;

function entry(id: (typeof profileIds)[number]): ScanProfileCatalogEntry {
	return {
		id,
		displayName: id,
		description: id,
		availability: id === "professional-full" ? "planned" : "stable",
		safetyClass: "R0",
		launchMode:
			id === "professional-full"
				? "unavailable"
				: [
						"dynamic-verification",
						"authenticated-web",
						"active-technical-lab",
						"business-logic-lab",
						"remediation-verification",
					].includes(id)
					? "dedicated_flow"
					: "profile_orchestrator",
		supportedTargets: ["full"],
		strictness: "strict",
		capabilityRequirements: [],
		requiredInputs: [],
	};
}

describe("launchable scan profile catalog", () => {
	it("uses one selector for all implemented profiles and withholds professional-full", () => {
		const response: ScanProfileCatalogResponse = {
			schemaVersion: 2,
			profiles: [],
			catalogEntries: profileIds.map(entry),
			genericStartCatalogProfileIds: [],
			defaultProfileIds: {
				full: "source-assurance",
				working_tree: "change-gate",
				commit: "change-gate",
				range: "change-gate",
			},
		};
		expect(toLaunchableScanProfiles(response).map((profile) => profile.id)).toEqual(
			profileIds.filter((id) => id !== "professional-full"),
		);
	});
});
