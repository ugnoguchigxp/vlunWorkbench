import { describe, expect, it } from "vitest";
import {
	formatScanOutcome,
	getProfileDisplay,
	getToolDisplay,
	TOOL_SUBTITLES,
} from "./scan-profile-display";

describe("scan profile display", () => {
	it("returns configured and fallback profile/tool displays", () => {
		expect(getProfileDisplay("baseline", "Fallback", "Fallback subtitle").name).toBe(
			"標準スキャン",
		);
		expect(getProfileDisplay("custom", "Custom", "Custom subtitle")).toEqual({
			name: "Custom",
			subtitle: "Custom subtitle",
		});
		expect(getToolDisplay("semgrep").name).toBe("Semgrep");
		expect(getToolDisplay("custom", "Custom tool")).toMatchObject({
			name: "Custom tool",
		});
		expect(getToolDisplay("custom").name).toBe("custom");
		expect(TOOL_SUBTITLES.osv).toContain("OSV");
	});

	it("formats known, empty, and unknown outcomes", () => {
		expect(formatScanOutcome("completed_with_warnings")).toBe("完了（警告あり）");
		expect(formatScanOutcome(null)).toBe("未確定");
		expect(formatScanOutcome("new_outcome")).toBe("NEW OUTCOME");
	});
});
