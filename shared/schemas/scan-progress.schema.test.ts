import { describe, expect, it } from "vitest";
import {
	scanStepFinishedEventDataSchema,
	scanStepStartedEventDataSchema,
} from "./scan-progress.schema";

const started = {
	schemaVersion: 1,
	stepId: "static_tool:gitleaks",
	kind: "static_tool",
	adapter: "gitleaks",
	displayName: "Gitleaks Secret Detection",
	position: 1,
	totalSteps: 2,
	required: true,
	planHash: "sha256:test",
} as const;

describe("scan progress event schemas", () => {
	it("accepts a started event payload", () => {
		expect(scanStepStartedEventDataSchema.parse(started)).toEqual(started);
	});

	it("accepts a finished event payload and rejects invalid counts", () => {
		expect(
			scanStepFinishedEventDataSchema.parse({
				...started,
				outcome: "completed",
				findingCount: 0,
				reasonCode: null,
				durationMs: 18,
			}),
		).toMatchObject({ outcome: "completed", findingCount: 0 });
		expect(
			scanStepFinishedEventDataSchema.safeParse({
				...started,
				outcome: "completed",
				findingCount: -1,
				reasonCode: null,
				durationMs: 18,
			}).success,
		).toBe(false);
	});
});
