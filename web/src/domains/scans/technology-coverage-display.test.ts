import { describe, expect, it } from "vitest";
import { readTechnologyCoverageDisplay } from "./technology-coverage-display";

describe("technology coverage display", () => {
	it("renders predicted capability rows before scanner execution", () => {
		const view = readTechnologyCoverageDisplay({
			technologyPlugins: {
				schemaVersion: 1,
				registryDigest: `sha256:${"b".repeat(64)}`,
				detections: [
					{
						pluginId: "build.python-requirements",
						detected: true,
						confidence: "high",
						limitations: [],
					},
				],
				capabilityPlan: {
					activePluginIds: ["build.python-requirements"],
					steps: [
						{
							stepId: "dependency:dependency.python-requirements",
							pluginIds: ["build.python-requirements"],
							coverageEffect: "partial",
							limitationCodes: ["python_requirements_pinned_entries_only"],
						},
					],
				},
			},
		});
		expect(view?.rows).toEqual([
			expect.objectContaining({
				pluginId: "build.python-requirements",
				executionStatus: "not_executed",
				support: "partial",
			}),
		]);
	});

	it("preserves partial and gap results and renders Go DAST as unsupported", () => {
		const view = readTechnologyCoverageDisplay({
			technologyPlugins: {
				schemaVersion: 1,
				registryDigest: `sha256:${"a".repeat(64)}`,
				detections: [
					{
						pluginId: "language.go",
						detected: true,
						confidence: "high",
						limitations: [],
					},
					{
						pluginId: "framework.go.gin",
						detected: true,
						confidence: "high",
						limitations: ["go_dast_auto_start_unsupported"],
					},
				],
				capabilityPlan: {
					activePluginIds: ["language.go", "framework.go.gin"],
				},
				pluginResults: [
					{
						pluginId: "framework.go.gin",
						capability: "endpoint_extraction",
						status: "completed",
						coverageEffect: "partial",
						limitationCodes: ["dynamic_routes_not_inferred"],
					},
					{
						pluginId: "language.go",
						capability: "project_structure",
						status: "skipped",
						coverageEffect: "gap",
						limitationCodes: ["analysis_adapter_unavailable"],
					},
				],
			},
		});
		expect(view?.rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ capability: "endpoint_extraction", support: "partial" }),
				expect.objectContaining({ capability: "project_structure", support: "gap" }),
				expect.objectContaining({ capability: "dast_start", support: "unsupported" }),
			]),
		);
	});
});
