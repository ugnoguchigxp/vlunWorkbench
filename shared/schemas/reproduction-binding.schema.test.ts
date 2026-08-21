import { describe, expect, it } from "vitest";
import { reproductionSpecV1Schema } from "./reproduction-binding.schema";

const digest = (value: string) => `sha256:${value.repeat(64)}`;

describe("reproductionSpecV1Schema", () => {
	it("requires versioned, complete reproduction provenance", () => {
		const spec = {
			schemaVersion: 1,
			profileId: "gitleaks-recheck",
			findingFingerprint: "finding-fingerprint",
			originalBinding: {
				sourceSnapshotDigest: digest("a"),
				executionPlanHash: digest("b"),
				scannerBindingHash: digest("c"),
			},
		};
		expect(reproductionSpecV1Schema.safeParse(spec).success).toBe(true);
		expect(
			reproductionSpecV1Schema.safeParse({
				...spec,
				originalBinding: { ...spec.originalBinding, scannerBindingHash: "missing" },
			}).success,
		).toBe(false);
	});
});
