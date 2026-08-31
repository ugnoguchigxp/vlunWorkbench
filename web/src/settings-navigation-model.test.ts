import { describe, expect, it } from "vitest";
import {
	searchSettingsNavigation,
	visibleSettingsNavigation,
} from "./settings-navigation-model";

describe("settings navigation", () => {
	it("does not expose admin sections to members", () => {
		const items = visibleSettingsNavigation(false);
		expect(items.map((item) => item.id)).toEqual(["overview", "system-context"]);
		expect(searchSettingsNavigation(items, "Codex")).toEqual([]);
	});

	it("finds static category metadata for administrators", () => {
		expect(searchSettingsNavigation(visibleSettingsNavigation(true), "Docker").map((item) => item.id)).toContain("scan-execution");
	});
});
