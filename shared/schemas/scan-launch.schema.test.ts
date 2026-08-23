import { describe, expect, test } from "bun:test";
import { scanLaunchPreviewRequestSchema, scanLaunchStartRequestSchema } from "./scan-launch.schema";

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
});
