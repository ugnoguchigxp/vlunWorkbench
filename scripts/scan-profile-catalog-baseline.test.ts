import { describe, expect, test } from "bun:test";
import { buildScanProfileCatalogBaseline } from "./scan-profile-catalog-baseline";

describe("scan profile catalog baseline", () => {
	test("characterizes every definition, including disabled active placeholders", async () => {
		const baseline = await buildScanProfileCatalogBaseline({
			generatedAt: "2026-08-21T00:00:00.000Z",
			sourceRevision: "a".repeat(40),
		});
		expect(baseline.variants).toEqual([
			expect.objectContaining({
				optionalAdapterIds: [],
				definitionCount: 22,
				enabledCount: 20,
				disabledIds: ["api-zap-active-lab", "runtime-zap-active-lab"],
			}),
			expect.objectContaining({
				optionalAdapterIds: ["semgrep"],
				definitionCount: 23,
				enabledCount: 21,
				disabledIds: ["api-zap-active-lab", "runtime-zap-active-lab"],
			}),
		]);
		for (const variant of baseline.variants) {
			expect(variant.profiles).toHaveLength(variant.definitionCount);
			expect(new Set(variant.profiles.map((profile) => profile.id)).size).toBe(
				variant.definitionCount,
			);
			expect(
				variant.profiles.every((profile) =>
					/^sha256:[0-9a-f]{64}$/.test(profile.executionFingerprint),
				),
			).toBe(true);
		}
	});
});
