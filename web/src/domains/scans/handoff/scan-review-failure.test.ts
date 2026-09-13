import { describe, expect, it } from "vitest";
import { classifyScanReviewFailure } from "./scan-review-failure";

describe("classifyScanReviewFailure", () => {
	it("returns null when no error is present", () => {
		expect(classifyScanReviewFailure(null)).toBeNull();
		expect(classifyScanReviewFailure(undefined)).toBeNull();
		expect(classifyScanReviewFailure("")).toBeNull();
	});

	it("classifies known failure families", () => {
		expect(
			classifyScanReviewFailure("improvement_request_prompt_budget_exceeded"),
		).toMatchObject({ category: "prompt_budget_failure" });
		expect(
			classifyScanReviewFailure(
				"llm_structured_output_validation_failed: Japanese review text is required",
			),
		).toMatchObject({ category: "japanese_language_validation_failure" });
		expect(
			classifyScanReviewFailure("llm_provider_execution_failed"),
		).toMatchObject({ category: "provider_failure" });
		expect(
			classifyScanReviewFailure("referenced findings not in bundle"),
		).toMatchObject({ category: "bundle_reference_violation" });
		expect(
			classifyScanReviewFailure("outside the saved warning group bundle"),
		).toMatchObject({ category: "bundle_reference_violation" });
		expect(
			classifyScanReviewFailure("outside the saved bundle"),
		).toMatchObject({ category: "bundle_reference_violation" });
		expect(classifyScanReviewFailure("json schema validation failed")).toMatchObject(
			{ category: "json_schema_validation_failure" },
		);
		expect(
			classifyScanReviewFailure("llm_structured_output_validation_failed"),
		).toMatchObject({ category: "json_schema_validation_failure" });
		expect(classifyScanReviewFailure("timeout from worker")).toMatchObject({
			category: "unknown",
		});
	});
});
