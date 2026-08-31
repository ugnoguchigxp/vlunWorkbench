import { describe, expect, test } from "bun:test";
import { scanProfileExitCode } from "./scan-profile-exit-code";

describe("scan profile exit code", () => {
	test("uses a distinct interactive exit code for every gate decision", () => {
		for (const gateDecision of ["pass", "fail", "blocked"] as const) {
			expect(
				scanProfileExitCode({
					executionSurface: "cli",
					ok: gateDecision === "pass",
					resultPolicy: "gate",
					gateDecision,
				}),
			).toBe(3);
		}
	});

	test("keeps a web child successful for a durable gate outcome", () => {
		expect(
			scanProfileExitCode({
				executionSurface: "web",
				ok: false,
				resultPolicy: "gate",
				gateDecision: "blocked",
			}),
		).toBe(0);
	});
});
