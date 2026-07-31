import { describe, expect, it } from "vitest";
import { measureDastStandardCapability } from "../../../scripts/benchmark/dast-standard-lib";

describe("owned DAST standard capability", () => {
	it(
		"meets route, precision, fail-closed, leakage, and budget gates",
		async () => {
			const report = await measureDastStandardCapability();

			expect(report.gatePassed).toBe(true);
			expect(Object.values(report.gates).every(Boolean)).toBe(true);
			expect(report.observations.vulnerableFindingCount).toBeGreaterThan(0);
			expect(report.observations.fixedFindingCount).toBe(0);
			expect(report.metrics.secretCanaryLeakage).toBe(0);
			expect(report.metrics.publicOrProductionRequests).toBe(0);
		},
		30_000,
	);
});
