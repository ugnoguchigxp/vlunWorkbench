import { describe, expect, it } from "vitest";
import { normalizeProfileStepResult } from "./normalized-step-result";

describe("normalized profile step result", () => {
	it("maps raw failure text to the registered execution failure code", () => {
		expect(
			normalizeProfileStepResult({
				kind: "static_tool",
				toolId: "gitleaks",
				toolRunId: null,
				required: true,
				status: "failed",
				findingCount: 0,
				exitCode: 1,
				error: "credential=should-never-be-persisted-as-a-reason-code",
				applicability: "applicable",
				reasonCode: null,
				coverageEffect: "gap",
				artifactIds: ["artifact-1"],
			}),
		).toMatchObject({
			stepId: "gitleaks",
			execution: "failed",
			reasonCodes: ["execution_failed"],
			evidenceRefs: ["artifact:artifact-1"],
			cleanupState: "not_required",
		});
	});

	it("preserves preflight blocking and auto-target cleanup in the normalized contract", () => {
		expect(
			normalizeProfileStepResult({
				kind: "dast",
				profileId: "web-passive-standard",
				required: true,
				status: "skipped",
				outcome: null,
				coverageStatus: "gap",
				limitationCodes: ["preflight_failed"],
				findingCount: 0,
				dastRunId: null,
				targetOrigin: null,
				error: "blocked",
				autoTarget: {
					scriptName: "dev",
					command: ["bun", "run", "dev"],
					port: 3000,
					origin: "http://127.0.0.1:3000",
					warnings: [],
				},
			}),
		).toMatchObject({
			execution: "blocked",
			cleanupState: "completed",
			reasonCodes: ["preflight_failed"],
		});
	});
});
