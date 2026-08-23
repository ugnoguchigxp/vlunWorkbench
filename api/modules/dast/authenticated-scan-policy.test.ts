import { describe, expect, it } from "vitest";
import { assertAuthenticatedPassiveScanRequest } from "./authenticated-scan-policy";

describe("authenticated passive scan policy", () => {
	it("allows login transactions separately but prohibits state-changing scan requests", () => {
		expect(() => assertAuthenticatedPassiveScanRequest("POST", "login")).not.toThrow();
		expect(() => assertAuthenticatedPassiveScanRequest("POST", "scan")).toThrow("policy_rejected");
	});
});
