import { describe, expect, it } from "vitest";
import type { DastRouteInventoryEntry } from "./types";
import { evaluateDastCoverage } from "./coverage-evaluator";

function route(
	path: string,
	state: DastRouteInventoryEntry["state"],
	overrides: Partial<DastRouteInventoryEntry> = {},
): DastRouteInventoryEntry {
	return {
		method: "GET",
		path,
		queryKeys: [],
		queryShapeHash: "empty",
		sources: ["configured"],
		depth: 0,
		required: true,
		authMode: "anonymous",
		state,
		statusCode: state === "succeeded" ? 200 : null,
		limitationCode: null,
		...overrides,
	};
}

describe("evaluateDastCoverage", () => {
	it("does not produce a clean verdict when every request has a transport error", () => {
		const result = evaluateDastCoverage({
			routeInventory: [
				route("/", "failed", { limitationCode: "target_unreachable" }),
				route("/health", "failed", {
					limitationCode: "target_unreachable",
				}),
			],
			requestCount: 2,
			findingCount: 0,
		});

		expect(result.verdict).toBe("inconclusive");
		expect(result.coverageStatus).toBe("partial");
		expect(result.outcome).toBe("inconclusive");
		expect(result.coverageSummary.transportErrorCount).toBe(2);
	});

	it("maps a requestless run to not_tested and gap", () => {
		const result = evaluateDastCoverage({
			routeInventory: [route("/", "not_tested")],
			requestCount: 0,
			findingCount: 0,
		});

		expect(result.verdict).toBe("not_tested");
		expect(result.coverageStatus).toBe("gap");
		expect(result.outcome).toBe("inconclusive");
	});

	it("keeps findings while reporting partial coverage", () => {
		const result = evaluateDastCoverage({
			routeInventory: [
				route("/", "succeeded"),
				route("/later", "not_tested", {
					required: false,
					limitationCode: "request_budget_exhausted",
				}),
			],
			requestCount: 1,
			findingCount: 1,
			budgetExhausted: true,
		});

		expect(result.verdict).toBe("findings");
		expect(result.coverageStatus).toBe("partial");
		expect(result.outcome).toBe("findings");
		expect(result.coverageSummary.budgetExhausted).toBe(true);
	});

	it("requires a successful explicit authentication assertion for clean coverage", () => {
		const result = evaluateDastCoverage({
			routeInventory: [route("/account", "succeeded")],
			requestCount: 1,
			findingCount: 0,
			authRequired: true,
			authSucceeded: false,
		});

		expect(result.verdict).toBe("inconclusive");
		expect(result.coverageStatus).toBe("gap");
		expect(result.limitationCodes).toContain("authentication_failed");
	});

	it("does not report full coverage when route inventory limits were reached", () => {
		const result = evaluateDastCoverage({
			routeInventory: [route("/", "succeeded")],
			requestCount: 1,
			findingCount: 0,
			limitationCodes: ["route_inventory_limit_reached"],
		});

		expect(result.coverageStatus).toBe("partial");
		expect(result.verdict).toBe("inconclusive");
		expect(result.limitationCodes).toContain("route_inventory_limit_reached");
	});
});
