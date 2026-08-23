import { describe, expect, it } from "vitest";
import {
	buildSettingsSectionSearch,
	parseSettingsSearch,
	resolveSettingsSection,
} from "./settings-route-search";

describe("settings route search", () => {
	it("keeps known non-overview sections and canonicalizes the rest", () => {
		expect(parseSettingsSearch({ section: "ai-models" })).toEqual({
			section: "ai-models",
		});
		expect(parseSettingsSearch({ section: "overview" })).toEqual({});
		expect(parseSettingsSearch({ section: "unknown" })).toEqual({});
		expect(resolveSettingsSection({})).toBe("overview");
		expect(buildSettingsSectionSearch("overview")).toEqual({});
	});
});
