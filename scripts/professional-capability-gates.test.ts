import { describe, expect, test } from "bun:test";
import { assessOsvEvidence } from "./professional-capability-gates";

describe("professional capability gates", () => {
	test("counts unique OSV ecosystems when Maven has Maven and Gradle fixtures", () => {
		const matrix = [
			"npm",
			"PyPI",
			"Go",
			"Maven",
			"Maven",
			"crates.io",
			"NuGet",
			"Packagist",
			"RubyGems",
		].map((ecosystem) => ({
			ecosystem,
			vulnerableDetected: true,
			fixedDetected: false,
		}));

		expect(
			assessOsvEvidence({
				bundleCount: 8,
				databaseSupplied: true,
				manifestState: "ready",
				matrix,
				minimumEcosystems: 8,
				networkRequests: 0,
			}),
		).toBe(true);
	});

	test("fails when any fixture produces a false positive", () => {
		expect(
			assessOsvEvidence({
				bundleCount: 1,
				databaseSupplied: true,
				manifestState: "ready",
				matrix: [
					{
						ecosystem: "npm",
						vulnerableDetected: true,
						fixedDetected: true,
					},
				],
				minimumEcosystems: 1,
				networkRequests: 0,
			}),
		).toBe(false);
	});
});
