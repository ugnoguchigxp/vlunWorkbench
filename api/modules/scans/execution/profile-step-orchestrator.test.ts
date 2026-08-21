import { describe, expect, it, vi } from "vitest";
import type { ExecuteProfileStepsParams } from "./profile-step-orchestrator-types";
import { executeProfileSteps } from "./profile-step-orchestrator";
import { profileStepRunnerRegistry } from "./execute-profile-step";
import { getProfileById } from "../profiles";

const profile = getProfileById("baseline");
if (!profile?.steps?.[0]) {
	throw new Error("baseline_profile_step_missing");
}
const step = profile.steps[0];

function buildParams(params: {
	applicability: "applicable" | "not_applicable";
	readiness: "ready" | "blocked";
}) {
	const createScanEvent = vi.fn().mockResolvedValue({});
	const scope = {
		scanRepo: { createScanEvent },
		scanRun: { id: "scan-1" },
		profile,
		profileSteps: [step],
		continueOnToolFailure: true,
		diffPlan: null,
		diffSnapshot: null,
		sharesRuntimeTarget: false,
		scanPreflight: { mode: "enforced" },
		executionPlan: {
			planHash: "sha256:test",
			steps: [
				{
					stepId: "gitleaks",
					kind: "static_tool",
					adapter: "gitleaks",
					required: true,
					applicability: params.applicability,
					readiness: params.readiness,
					requirement: "required_if_applicable",
					reasonCodes: ["tool_unavailable"],
					evidenceRefs: [],
				},
			],
		},
	};
	return {
		createScanEvent,
		params: scope as unknown as ExecuteProfileStepsParams,
	};
}

describe("executeProfileSteps lifecycle events", () => {
	it("registers every currently supported profile step kind", () => {
		expect(Object.keys(profileStepRunnerRegistry).sort()).toEqual([
			"api_schema_scan",
			"container_image_scan",
			"dast",
			"runtime_scanner",
			"sbom_export",
			"static_tool",
		]);
	});

	it("emits a terminal not_applicable event when a planned step is skipped", async () => {
		const fixture = buildParams({
			applicability: "not_applicable",
			readiness: "ready",
		});

		const result = await executeProfileSteps(fixture.params);

		expect(result.stepResults[0]).toMatchObject({ status: "skipped" });
		expect(fixture.createScanEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				eventType: "scan.step.finished",
				data: expect.objectContaining({ outcome: "not_applicable" }),
			}),
		);
		expect(fixture.createScanEvent).not.toHaveBeenCalledWith(
			expect.objectContaining({ eventType: "scan.step.started" }),
		);
	});

	it("emits a terminal blocked event when enforced preflight blocks a step", async () => {
		const fixture = buildParams({
			applicability: "applicable",
			readiness: "blocked",
		});

		const result = await executeProfileSteps(fixture.params);

		expect(result.profileFailingToolFailed).toBe(true);
		expect(fixture.createScanEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				eventType: "scan.step.finished",
				data: expect.objectContaining({
					outcome: "blocked",
					reasonCode: "preflight_failed",
				}),
			}),
		);
	});
});
