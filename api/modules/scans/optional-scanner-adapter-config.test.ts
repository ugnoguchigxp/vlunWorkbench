import { describe, expect, test } from "bun:test";
import {
	optionalScannerSelection,
	parseOptionalScannerAdapterIds,
} from "./optional-scanner-adapter-config";

describe("optional scanner adapter configuration", () => {
	test("maps the legacy enabled list to preferred selection", () => {
		expect(
			optionalScannerSelection("semgrep", {
				preferredIds: parseOptionalScannerAdapterIds("semgrep, semgrep"),
				requiredIds: [],
			}),
		).toBe("preferred");
	});

	test("lets an explicit must-run selection override preferred", () => {
		expect(
			optionalScannerSelection("semgrep", {
				preferredIds: ["semgrep"],
				requiredIds: ["semgrep"],
			}),
		).toBe("required");
		expect(
			optionalScannerSelection("semgrep", {
				preferredIds: [],
				requiredIds: [],
			}),
		).toBe("disabled");
	});
});
