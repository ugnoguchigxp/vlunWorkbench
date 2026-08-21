import { describe, expect, it } from "vitest";
import { scanPreflightResultV1Schema } from "../../../shared/schemas/scan-preflight.schema";
import { buildRuntimeIsolationPreflight } from "./runtime-isolation-preflight";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

describe("buildRuntimeIsolationPreflight", () => {
	it("turns an unavailable isolated runtime into a V2 blocked contract without weakening legacy checks", () => {
		const base = scanPreflightResultV1Schema.parse({
			schemaVersion: 1,
			projectId: null,
			profileId: "runtime-web-safe",
			sourceRevision: null,
			sourceState: "clean",
			mode: "enforced",
			status: "ready",
			createdAt: "2026-08-22T00:00:00.000Z",
			checks: [],
			summary: { ready: 0, blockedRequired: 0, blockedOptional: 0, notApplicable: 0 },
			limitationCodes: [],
			binding: {
				resolvedProfileHash: digest("a"),
				executionHash: digest("b"),
				scannerManifestHash: null,
				scannerVersionsHash: digest("c"),
				dockerImagesHash: null,
				targetPlanHash: null,
				sourceRevisionHash: null,
				profileInputsHash: null,
			},
			bindingHash: digest("d"),
			preflightHash: digest("e"),
		});
		const result = buildRuntimeIsolationPreflight({
			base,
			planning: { status: "blocked", reasonCode: "runtime_image_missing" },
			networkReady: false,
			cleanupReady: true,
		});
		expect(result.schemaVersion).toBe(2);
		expect(result.status).toBe("blocked");
		expect(result.binding.runtimeIsolation).toEqual({
			status: "blocked",
			reasonCode: "runtime_image_missing",
		});
		expect(result.checks.at(-1)).toMatchObject({
			kind: "runtime_source_projection",
			status: "blocked",
		});
	});
});
