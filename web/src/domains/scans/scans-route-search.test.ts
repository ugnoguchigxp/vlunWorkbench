import { describe, expect, it } from "vitest";
import {
	buildClosedFindingSearch,
	normalizeScansSearch,
	parseScansSearch,
	resolveRequestedFindingId,
} from "./scans-route-search";

describe("scan workspace route search", () => {
	it("keeps only identifiers that belong to the selected tab", () => {
		expect(
			normalizeScansSearch({
				projectId: "project-1",
				scanRunId: "scan-1",
				tab: "overview",
				findingId: "finding-1",
				reportId: "report-1",
			}),
		).toEqual({
			projectId: "project-1",
			scanRunId: "scan-1",
			findingId: "finding-1",
		});
	});

	it("uses overview as the canonical default and rejects unknown input", () => {
		expect(
			parseScansSearch({
				projectId: "project-1",
				tab: "not-a-tab",
				findingId: "finding-1",
			}),
		).toEqual({ projectId: "project-1" });
	});

	it("normalizes the former findings tab to the unified overview", () => {
		expect(
			parseScansSearch({
				projectId: "project-1",
				tab: "findings",
				findingId: "finding-1",
			}),
		).toEqual({ projectId: "project-1", findingId: "finding-1" });
	});

	it("retains a report only in the report tab", () => {
		expect(
			parseScansSearch({
				projectId: "project-1",
				scanRunId: "scan-1",
				tab: "report",
				reportId: "report-1",
			}),
		).toEqual({
			projectId: "project-1",
			scanRunId: "scan-1",
			tab: "report",
			reportId: "report-1",
		});
	});

	it("removes the finding id when the detail drawer closes", () => {
		const closedSearch = buildClosedFindingSearch({
			projectId: "project-1",
			scanRunId: "scan-1",
		});

		expect(closedSearch).toEqual({
			projectId: "project-1",
			scanRunId: "scan-1",
		});
		expect(
			resolveRequestedFindingId(closedSearch, ["finding-1"]),
		).toBe("");
	});
});
