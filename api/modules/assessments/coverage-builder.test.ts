import { describe, expect, it } from "vitest";
import { buildCoverageResults } from "./coverage-builder";
import { assertCoverageCatalogIntegrity } from "./coverage-catalog";
import type { ToolSummary } from "../scans/summary-builder";

function tool(overrides: Partial<ToolSummary> = {}): ToolSummary {
	return {
		toolId: "semgrep",
		toolRunId: "tool-run-1",
		status: "completed",
		required: true,
		exitCode: 0,
		toolVersion: "1",
		findingCount: 0,
		severityCounts: {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			info: 0,
			unknown: 0,
		},
		artifactCount: 1,
		error: null,
		...overrides,
	};
}

describe("coverage builder", () => {
	it("keeps catalog IDs unique and resolvable", () => {
		expect(() => assertCoverageCatalogIntegrity()).not.toThrow();
	});

	it("does not turn partial automation with zero findings into full control assurance", () => {
		const results = buildCoverageResults({ tools: [tool()] });
		expect(
			results.find((row) => row.controlId === "ASVS-v5.0.0-1.2.4"),
		).toMatchObject({
			status: "inconclusive",
			reasonCode: "partial_automation_without_finding",
			evidenceRefs: [{ kind: "tool_run", id: "tool-run-1" }],
		});
		expect(results.find((row) => row.controlId === "API1:2023")).toMatchObject({
			status: "not_tested",
			evidenceRefs: [],
		});
	});

	it("does not turn failed scanner execution into a passing control", () => {
		const results = buildCoverageResults({
			tools: [tool({ status: "failed", findingCount: 0 })],
		});
		expect(
			results.find((row) => row.controlId === "ASVS-v5.0.0-1.2.4"),
		).toMatchObject({
				status: "inconclusive",
				reasonCode: "scanner_failed",
		});
	});

	it("maps persisted authorization-matrix evidence to API authorization controls", () => {
		const results = buildCoverageResults(
			{ tools: [] },
			[
				{
					key: "api-authorization-matrix",
					status: "completed",
					findingCount: 1,
					evidenceRefs: [
						{ kind: "active_assessment", id: "active-run-1" },
					],
				},
			],
		);
		expect(results.find((row) => row.controlId === "API1:2023")).toMatchObject(
			{
				status: "tested_failed",
				reasonCode: "finding_detected",
				evidenceRefs: [
					{ kind: "active_assessment", id: "active-run-1" },
				],
			},
		);
		expect(results.find((row) => row.controlId === "API5:2023")).toMatchObject(
			{
				status: "tested_failed",
			},
		);
	});

	it("preserves inconclusive and failed-cleanup active evidence", () => {
		for (const [status, reasonCode] of [
			["inconclusive", "active_assessment_inconclusive"],
			["failed_cleanup", "cleanup_failed"],
		] as const) {
			const results = buildCoverageResults(
				{ tools: [] },
				[
					{
						key: "api-authorization-matrix",
						status,
						findingCount: 0,
						reasonCode,
						evidenceRefs: [
							{ kind: "active_assessment", id: `active-${status}` },
						],
					},
				],
			);
			expect(results.find((row) => row.controlId === "API1:2023")).toMatchObject({
				status: "inconclusive",
				reasonCode,
			});
		}
	});
});
