import { describe, expect, it } from "bun:test";
import { buildNightworkersCliCapabilities } from "./nightworkers-security-capabilities";

describe("NightWorkers security CLI capabilities", () => {
	it("exposes stable presets and allowlisted custom profiles without a server", () => {
		const capabilities = buildNightworkersCliCapabilities(
			"/workspace/sample-project",
			[
				"source-baseline",
				"diff-source-baseline",
				"diff-basic-security",
				"basic-security",
				"detailed-security",
				"dependency-manifest",
				"artifact",
			],
		);
		expect(capabilities.provider).toEqual({
			id: "vulnworkbench",
			version: "cli-2",
		});
		expect(capabilities.project.displayName).toBe("sample-project");
		expect(capabilities.presets.map((preset) => preset.id)).toEqual([
			"quick",
			"standard",
			"deep",
		]);
		expect(
			capabilities.selectableProfiles.map((profile) => profile.ref),
		).toEqual([
			"source-baseline",
			"diff-source-baseline",
			"diff-basic-security",
			"basic-security",
			"dependency-manifest",
			"artifact",
			"detailed-security",
		]);
		expect(
			capabilities.selectableProfiles.some(
				(profile) => profile.ref === "full-security-scan",
			),
		).toBe(false);
	});
});
