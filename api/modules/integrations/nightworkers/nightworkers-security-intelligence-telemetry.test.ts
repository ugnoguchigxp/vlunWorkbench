import { describe, expect, it, vi } from "vitest";
import { emitNightworkersSecurityIntelligenceTelemetry } from "./nightworkers-security-intelligence-telemetry";

describe("NightWorkers Security Intelligence telemetry", () => {
	it("emits aggregate-only pilot metrics", () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
		emitNightworkersSecurityIntelligenceTelemetry({
			dependencyBuildDurationMs: 12.5,
			payloadBytes: 2048,
			authorizationStatus: "unavailable",
			dependencyOutcome: "no_findings_observed",
			evidenceRefCount: 3,
			limitationCount: 1,
		});

		const payload = info.mock.calls[0]?.[0] ?? "";
		expect(JSON.parse(payload)).toMatchObject({
			event: "nightworkers.security_intelligence.assessment_built",
			payloadBytes: 2048,
			authorizationStatus: "unavailable",
		});
		expect(payload).not.toMatch(/(?:\/Users\/|\/workspace\/|sourceRevision)/);
		info.mockRestore();
	});
});
