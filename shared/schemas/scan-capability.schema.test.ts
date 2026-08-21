import { describe, expect, it } from "vitest";
import {
	scanCapabilityIdSchema,
	scanCapabilityRequirementsSchema,
} from "./scan-capability.schema";

describe("scan capability schema", () => {
	it("accepts the fixed capability catalog and rejects unknown IDs", () => {
		expect(scanCapabilityIdSchema.options).toHaveLength(17);
		expect(scanCapabilityIdSchema.safeParse("source_sast").success).toBe(true);
		expect(scanCapabilityIdSchema.safeParse("unbounded_fuzz").success).toBe(false);
	});

	it("rejects duplicate profile capability requirements", () => {
		expect(
			scanCapabilityRequirementsSchema.safeParse([
				{ capabilityId: "source_sast", requirement: "required_if_applicable" },
				{ capabilityId: "source_sast", requirement: "advisory" },
			]),
		).toMatchObject({ success: false });
	});
});
