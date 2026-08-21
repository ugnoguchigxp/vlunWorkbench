import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScanProfileCatalogList } from "./scan-profile-catalog-list";

describe("ScanProfileCatalogList", () => {
	it("shows dedicated and planned profiles without making them generic start choices", () => {
		const markup = renderToStaticMarkup(
			createElement(ScanProfileCatalogList, {
				genericStartProfileIds: ["source-assurance"],
				entries: [
					{
						id: "source-assurance",
						displayName: "Source",
						description: "",
						availability: "stable",
						launchMode: "profile_orchestrator",
						supportedTargets: ["full"],
						strictness: "strict",
						capabilityRequirements: [],
					},
					{
						id: "professional-full",
						displayName: "Professional full",
						description: "",
						availability: "planned",
						launchMode: "unavailable",
						supportedTargets: ["full"],
						strictness: "strict",
						capabilityRequirements: [],
						limitationCodes: ["promotion_dependency_not_met"],
					},
				],
			}),
		);
		expect(markup).toContain("Professional full");
		expect(markup).toContain("計画中");
		expect(markup).not.toContain(">Source（");
	});
});
