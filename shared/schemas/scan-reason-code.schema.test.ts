import { describe, expect, it } from "vitest";
import {
	getScanReasonCodeDefinition,
	scanReasonCodeSchema,
	scanReasonCodeRegistry,
} from "./scan-reason-code.schema";

describe("scan reason code registry", () => {
	it("covers every declared code with a secret-safe operator action", () => {
		expect(Object.keys(scanReasonCodeRegistry)).toEqual(scanReasonCodeSchema.options);
		expect(getScanReasonCodeDefinition("cleanup_failed")).toMatchObject({
			category: "cleanup",
			coverageEffect: "gap",
		});
		expect(
			getScanReasonCodeDefinition("capability_not_executed"),
		).toMatchObject({
			category: "execution",
			coverageEffect: "gap",
			action: "rerun_scan",
		});
	});

	it("rejects unregistered reason codes", () => {
		expect(scanReasonCodeSchema.safeParse("tool_error_with_token").success).toBe(false);
	});
});
