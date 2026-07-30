import { describe, expect, test } from "vitest";
import { measuredCapabilityClaimSchema } from "./security-capability.schema";

const baseClaim = {
	claimId: "measured-automated-web-api-assessment-v1" as const,
	scopeCatalogVersion: "1.0.0",
	benchmarkPolicyVersion: "1.0.0",
	unsupportedCapabilities: ["browser-authenticated-zap-active"],
};

describe("measured capability claim", () => {
	test("requires a passing benchmark run before the claim can be met", () => {
		expect(() =>
			measuredCapabilityClaimSchema.parse({
				...baseClaim,
				status: "met",
				passingBenchmarkRunId: null,
			}),
		).toThrow();
		expect(
			measuredCapabilityClaimSchema.parse({
				...baseClaim,
				status: "met",
				passingBenchmarkRunId: "00000000-0000-4000-8000-000000000001",
			}).status,
		).toBe("met");
	});

	test("permits a conservative not_met claim without a passing run", () => {
		expect(
			measuredCapabilityClaimSchema.parse({
				...baseClaim,
				status: "not_met",
				passingBenchmarkRunId: null,
			}).status,
		).toBe("not_met");
	});
});
