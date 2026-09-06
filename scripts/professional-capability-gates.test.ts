import { describe, expect, test } from "bun:test";
import { assessOsvEvidence } from "./professional-capability-gates";

describe("professional capability gates", () => {
	test("does not accept a different ecosystem set or stale unisolated evidence", () => {
		const gate = {
			bundleCount: 1, databaseSupplied: true, manifestState: "ready", minimumEcosystems: 1, networkRequests: 0,
			matrix: [{ ecosystem: "npm", vulnerableDetected: true, fixedDetected: false }],
		};
		expect(assessOsvEvidence({ ...gate, expectedEcosystems: ["PyPI"] })).toBe(false);
		const expected = { gitCommit: "current", scannerManifestHash: "manifest", fixtureHash: "fixtures", implementationHash: "implementation" };
		const actual = { ...expected, schemaVersion: 2, networkIsolation: "docker_network_none", ok: true };
		expect(assessOsvEvidence({ ...gate, provenance: { ...expected, actual } })).toBe(true);
		for (const key of Object.keys(expected)) {
			expect(assessOsvEvidence({ ...gate, provenance: { ...expected, actual: { ...actual, [key]: "stale" } } })).toBe(false);
		}
		expect(assessOsvEvidence({ ...gate, provenance: { ...expected, actual: { ...actual, networkIsolation: "not_enforced" } } })).toBe(false);
	});
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
