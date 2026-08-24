export type ScanReviewFailureCategory =
	| "prompt_budget_failure"
	| "provider_failure"
	| "json_schema_validation_failure"
	| "japanese_language_validation_failure"
	| "bundle_reference_violation"
	| "unknown";

export type ScanReviewFailureView = {
	category: ScanReviewFailureCategory;
	label: string;
	rawError: string;
	nextAction: string;
};

export function classifyScanReviewFailure(
	error: string | null | undefined,
): ScanReviewFailureView | null {
	if (!error) return null;
	if (error.includes("improvement_request_prompt_budget_exceeded")) {
		return {
			category: "prompt_budget_failure",
			label: "入力サイズ超過",
			rawError: error,
			nextAction:
				"警告の圧縮後も上限を超えました。場所情報または代表証跡のサイズを確認してください。",
		};
	}
	if (
		error.includes("llm_structured_output_validation_failed") &&
		error.includes("Japanese review text is required")
	) {
		return {
			category: "japanese_language_validation_failure",
			label: "日本語検証エラー",
			rawError: error,
			nextAction: "scan review を再実行してください。",
		};
	}
	if (error.includes("llm_provider_execution_failed")) {
		return {
			category: "provider_failure",
			label: "Provider 実行エラー",
			rawError: error,
			nextAction: "provider route/API key を確認してから再実行してください。",
		};
	}
	if (
		error.includes("referenced findings not in bundle") ||
		error.includes("outside the saved warning group bundle") ||
		error.includes("outside the saved bundle")
	) {
		return {
			category: "bundle_reference_violation",
			label: "Bundle 参照エラー",
			rawError: error,
			nextAction: "現在の scan bundle で scan review を再実行してください。",
		};
	}
	if (/json|schema|validation/i.test(error)) {
		return {
			category: "json_schema_validation_failure",
			label: "JSON/schema 検証エラー",
			rawError: error,
			nextAction:
				"再実行し、続く場合は prompt/schema の不一致を確認してください。",
		};
	}
	return {
		category: "unknown",
		label: "不明なエラー",
		rawError: error,
		nextAction: "raw error を確認してください。",
	};
}
