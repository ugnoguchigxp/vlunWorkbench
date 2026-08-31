import { describe, expect, it } from "bun:test";
import { businessLogicProfileOutcome } from "./business-logic-runner";

describe("businessLogicProfileOutcome", () => {
	it("keeps business findings separate from operational profile completion", () => {
		expect(businessLogicProfileOutcome("observed")).toBe("completed");
		expect(businessLogicProfileOutcome("not_observed")).toBe("completed");
		expect(businessLogicProfileOutcome("inconclusive")).toBe("incomplete");
		expect(businessLogicProfileOutcome("not_tested")).toBe("incomplete");
		expect(businessLogicProfileOutcome("failed_cleanup")).toBe("failed");
	});
});
