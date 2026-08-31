import { describe, expect, it } from "vitest";
import {
	formatScanOutcome,
	getProfileDisplay,
	getScanStepDisplay,
	getToolDisplay,
	SCAN_STEP_DISPLAY,
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
		expect(getScanStepDisplay("trivy", "trivy", "Trivy").purpose).toHaveLength(
			3,
		);
		expect(TOOL_SUBTITLES.osv).toContain("OSV");
	});

	it("defines a purpose for every shipped step kind", () => {
		for (const stepId of [
			"gitleaks",
			"osv",
			"trivy",
			"semgrep",
			"sbom_export:trivy",
			"dast:web-passive-standard",
			"runtime_scanner:nuclei-safe",
			"runtime_scanner:zap-baseline",
			"api_schema_scan:schemathesis",
		]) {
			expect(SCAN_STEP_DISPLAY[stepId]?.purpose.length).toBeGreaterThan(0);
		}
	});

	it("formats known, empty, and unknown outcomes", () => {
		expect(formatScanOutcome("completed_with_warnings")).toBe("完了（警告あり）");
		expect(formatScanOutcome("blocked")).toBe("ブロック済み");
		expect(formatScanOutcome("incomplete")).toBe("未完了");
		expect(formatScanOutcome(null)).toBe("未確定");
		expect(formatScanOutcome("new_outcome")).toBe("NEW OUTCOME");
	});
});
