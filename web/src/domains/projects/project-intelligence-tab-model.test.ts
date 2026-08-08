import { describe, expect, it } from "vitest";
import {
	parseFocusPath,
	parseIntelligenceViewId,
	parseOptionalIntelligenceViewId,
} from "./project-intelligence-tab-model";

describe("project Intelligence tab model", () => {
	it("accepts the four public view ids", () => {
		for (const value of ["priority", "investigate", "landscape", "guided"]) {
			expect(parseIntelligenceViewId(value)).toBe(value);
			expect(parseOptionalIntelligenceViewId(value)).toBe(value);
		}
	});

	it("falls back to priority and omits unknown route values", () => {
		expect(parseIntelligenceViewId("unknown")).toBe("priority");
		expect(parseIntelligenceViewId(undefined)).toBe("priority");
		expect(parseOptionalIntelligenceViewId("unknown")).toBeUndefined();
	});

	it("normalizes optional focus paths", () => {
		expect(parseFocusPath("  src/app.ts  ")).toBe("src/app.ts");
		expect(parseFocusPath(" ")).toBeNull();
		expect(parseFocusPath("a".repeat(1_025))).toBeNull();
	});
});
