import { describe, expect, it } from "vitest";
import { collectBundleLimitations } from "./scan-diagnostic-helpers";
import type { ScanReviewBundle } from "./scan-review-bundle";

describe("collectBundleLimitations", () => {
	it("makes partial optional runtime assessment coverage diagnostic-visible", () => {
		const bundle = {
			limits: { includedFindings: 0, totalFindings: 0 },
			tools: [],
			scanRun: {
				metadata: {
					runtimeAssessmentCoverage: {
						coverageStatus: "partial",
						steps: [{ stepId: "dast:web-passive-standard" }],
						limitationCodes: ["request_budget_exhausted"],
					},
				},
			},
		} as unknown as ScanReviewBundle;

		expect(collectBundleLimitations(bundle)).toEqual([
			"runtime:request_budget_exhausted",
			"runtime_assessment_coverage_partial",
		]);
	});
});
