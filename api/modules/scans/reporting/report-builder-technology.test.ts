import { describe, expect, it } from "bun:test";
import { builtInTechnologyPluginRegistry } from "../../../plugins/builtin";
import { renderTechnologyCoverage } from "./report-builder-technology";

describe("technology coverage report", () => {
	it("renders measured plugin coverage without hard-coded ecosystems", () => {
		const lines: string[] = [];
		renderTechnologyCoverage(lines, {
			technologyPlugins: {
				schemaVersion: 1,
				registryDigest:
					builtInTechnologyPluginRegistry.registryDigest,
				detections: [
					{
						pluginId: "language.java",
						detected: true,
						confidence: "high",
						evidence: [
							{ path: "src/App.java", kind: "extension" },
						],
						limitations: [],
					},
					{
						pluginId: "build.gradle",
						detected: true,
						confidence: "high",
						evidence: [
							{ path: "build.gradle", kind: "manifest" },
						],
						limitations: [],
					},
				],
				capabilityPlan: {
					schemaVersion: 1,
					registryDigest:
						builtInTechnologyPluginRegistry.registryDigest,
					activePluginIds: ["language.java", "build.gradle"],
					languages: ["java"],
					buildSystems: ["gradle"],
					frameworks: [],
					steps: [
						{
							stepId: "dependency:dependency.gradle",
							pluginIds: ["build.gradle"],
							applicability: "applicable",
							reasonCode: "gradle_dependency_lock_missing",
							coverageEffect: "gap",
							limitationCodes: ["gradle_dependency_lock_missing"],
						},
					],
				},
				pluginResults: [
					{
						pluginId: "build.gradle",
						capability: "dependency:dependency.gradle",
						status: "skipped",
						coverageEffect: "gap",
						limitationCodes: ["gradle_dependency_lock_missing"],
					},
				],
			},
		});

		const markdown = lines.join("\n");
		expect(markdown).toContain("## Technology Coverage");
		expect(markdown).toContain("| Gradle | yes | no | partial | gap |");
		expect(markdown).not.toContain("PyPI");
		expect(markdown).not.toContain("RubyGems");
	});
});
