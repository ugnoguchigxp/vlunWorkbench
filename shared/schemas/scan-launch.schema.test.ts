import { describe, expect, test } from "vitest";
import {
	isCompleteScanLaunchInput,
	scanLaunchPreviewRequestSchema,
	scanLaunchStartRequestSchema,
} from "./scan-launch.schema";

const digest = `sha256:${"a".repeat(64)}`;

describe("scan launch schemas", () => {
	test("allows a strict partial preview input", () => {
		const parsed = scanLaunchPreviewRequestSchema.parse({
			schemaVersion: 1,
			profileId: "runtime-passive",
			target: { kind: "full" },
			input: {},
		});
		expect((parsed as { profileId: string }).profileId).toBe("runtime-passive");
	});

	test("rejects a partial input from another profile", () => {
		expect(
			scanLaunchPreviewRequestSchema.safeParse({
				schemaVersion: 1,
				profileId: "source-assurance",
				target: { kind: "full" },
				input: { kind: "authenticated_web", identityRole: "reader" },
			}).success,
		).toBe(false);
		expect(
			scanLaunchPreviewRequestSchema.safeParse({
				schemaVersion: 1,
				profileId: "release-artifact",
				target: { kind: "full" },
				input: { kind: "authenticated_web", identityRole: "reader" },
			}).success,
		).toBe(false);
	});

	test("requires full, profile-matched input when starting", () => {
		const request = {
			schemaVersion: 1,
			profileId: "runtime-passive",
			target: { kind: "full" },
			input: { kind: "auto_project_runtime", executionConsent: true },
			expectedCatalogEntryHash: digest,
			expectedReadinessHash: digest,
			expectedPlanHash: digest,
			expectedTargetDigest: digest,
		};
		expect(scanLaunchStartRequestSchema.safeParse(request).success).toBe(true);
		expect(
			scanLaunchStartRequestSchema.safeParse({
				...request,
				input: { kind: "authenticated_web" },
			}).success,
		).toBe(false);
	});

	test("rejects the unimplemented configured API schema source", () => {
		expect(
			scanLaunchPreviewRequestSchema.safeParse({
				schemaVersion: 1,
				profileId: "api-readonly",
				target: { kind: "full" },
				input: {
					kind: "api_readonly",
					runtime: { mode: "auto_project_runtime" },
					schemaSource: {
						mode: "configured",
						schemaRef: "00000000-0000-4000-8000-000000000000",
						expectedSchemaHash: digest,
					},
				},
			}).success,
		).toBe(false);
	});

	test("validates complete readiness input with the start contract", () => {
		expect(
			isCompleteScanLaunchInput("runtime-passive", {
				kind: "auto_project_runtime",
			}),
		).toBe(false);
		expect(
			isCompleteScanLaunchInput("runtime-passive", {
				kind: "auto_project_runtime",
				executionConsent: true,
			}),
		).toBe(true);
		expect(
			isCompleteScanLaunchInput("sanitizer-fuzz-lab", {
				kind: "builtin_dynamic",
				dynamicProfileId: "rust-sanitizer",
				dynamicKind: "fuzz",
				executionConsent: true,
			}),
		).toBe(true);
	});
});
