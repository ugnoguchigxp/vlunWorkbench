import { describe, expect, it } from "vitest";
import { scanProfileSchema } from "./scan-profile.schema";

const baseProfile = {
	id: "contract-test",
	name: "Contract test",
	description: "Ensures profile schema compatibility.",
	enabled: true,
	defaultTimeoutSec: 60,
	tools: [],
};

describe("scan profile capability requirements", () => {
	it("keeps legacy profiles valid when requirements are absent", () => {
		expect(scanProfileSchema.safeParse(baseProfile).success).toBe(true);
	});

	it("accepts a declared capability contract", () => {
		const parsed = scanProfileSchema.parse({
			...baseProfile,
			capabilityRequirements: [
				{ capabilityId: "source_sast", requirement: "required_if_applicable" },
			],
		});
		expect(parsed.capabilityRequirements).toEqual([
			{ capabilityId: "source_sast", requirement: "required_if_applicable" },
		]);
	});
});
