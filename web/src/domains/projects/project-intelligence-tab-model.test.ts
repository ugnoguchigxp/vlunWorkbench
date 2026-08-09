import { describe, expect, it } from "vitest";
import {
	parseFocusPath,
	parseIntelligenceViewId,
	parseModuleId,
	parseOptionalIntelligenceViewId,
	parseOptionalModuleId,
} from "./project-intelligence-tab-model";

describe("project Intelligence tab model", () => {
	it("accepts the four public view ids", () => {
		for (const value of [
			"overview",
			"modules",
			"relationships",
			"handoff",
		]) {
			expect(parseIntelligenceViewId(value)).toBe(value);
			expect(parseOptionalIntelligenceViewId(value)).toBe(value);
		}
	});

	it("normalizes legacy links to the matching structure-first view", () => {
		expect(parseIntelligenceViewId("priority")).toBe("overview");
		expect(parseIntelligenceViewId("investigate")).toBe("modules");
		expect(parseIntelligenceViewId("landscape")).toBe("relationships");
		expect(parseIntelligenceViewId("guided")).toBe("handoff");
	});

	it("falls back to overview and omits unknown route values", () => {
		expect(parseIntelligenceViewId("unknown")).toBe("overview");
		expect(parseIntelligenceViewId(undefined)).toBe("overview");
		expect(parseOptionalIntelligenceViewId("unknown")).toBeUndefined();
	});

	it("normalizes optional focus paths", () => {
		expect(parseFocusPath("  src/app.ts  ")).toBe("src/app.ts");
		expect(parseFocusPath(" ")).toBeNull();
		expect(parseFocusPath("a".repeat(1_025))).toBeNull();
	});

	it("normalizes bounded module ids", () => {
		expect(parseModuleId("  module:auth  ")).toBe("module:auth");
		expect(parseOptionalModuleId("module:api")).toBe("module:api");
		expect(parseModuleId(" ")).toBeNull();
		expect(parseModuleId("a".repeat(257))).toBeNull();
	});
});
