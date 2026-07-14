import { describe, expect, it } from "vitest";
import {
	getReportSectionDefinition,
	REPORT_SECTION_DEFINITIONS,
	REPORT_SECTION_IDS,
} from "./report-sections";

describe("report section definitions", () => {
	it("exposes stable ids and resolves known sections", () => {
		expect(REPORT_SECTION_IDS).toHaveLength(REPORT_SECTION_DEFINITIONS.length);
		expect(getReportSectionDefinition("risk-ranking")).toMatchObject({
			id: "risk-ranking",
			markdownHeading: "## Risk Ranking",
		});
	});

	it("falls back to the executive summary for an unknown id", () => {
		expect(getReportSectionDefinition("unknown" as never)).toBe(
		REPORT_SECTION_DEFINITIONS[0],
		);
	});
});
