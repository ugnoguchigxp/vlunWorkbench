import { describe, expect, it } from "vitest";
import { readinessPresentation } from "./project-intelligence-readiness";

describe("Project Intelligence readiness presentation", () => {
	it("keeps stale, degraded, missing, and failed actions distinct", () => {
		const statuses = ["stale", "degraded", "missing", "failed"] as const;
		const actions = statuses.map((status) => readinessPresentation({ status, reasonCodes: [] }).nextAction);
		expect(new Set(actions).size).toBe(statuses.length);
	});

	it("does not suggest mutation for available data", () => {
		expect(readinessPresentation({ status: "available", reasonCodes: [] })).toEqual({ label: "Available", nextAction: null });
	});
});
