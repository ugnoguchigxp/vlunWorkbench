import type { PromptInvocation } from "s11tnext";
import type { ReviewInputBundle } from "../modules/reviews/finding-review-types";
import type { ScanReviewBundle } from "../modules/scans/scan-review-bundle";
import { PROMPT_KEYS, promptCatalog } from "./catalog";
import { toJsonValue } from "./json-value";

const bindJapanese = promptCatalog.bind({
	instructionLocale: "ja-JP",
});

const bindEnglish = promptCatalog.bind({
	instructionLocale: "en-US",
});

export function bindAgenticSearchSystemContext(params: {
	userSystemContext: string;
	category?: string;
	topK: number;
}): PromptInvocation<"agenticSearch.system", "system"> {
	return bindJapanese(PROMPT_KEYS.agenticSearch, {
		category: params.category?.trim() || "all",
		topK: params.topK,
		userSystemContext: params.userSystemContext.trim(),
	});
}

export function bindChatSearchDecisionSystemContext() {
	return bindEnglish(PROMPT_KEYS.chatSearchDecision, {});
}

export function bindChatDirectAnswerSystemContext() {
	return bindEnglish(PROMPT_KEYS.chatDirectAnswer, {});
}

export function bindChatGroundedAnswerSystemContext(localContext: string) {
	return bindEnglish(PROMPT_KEYS.chatGroundedAnswer, { localContext });
}

export function bindFindingReviewSystemContext() {
	return bindJapanese(PROMPT_KEYS.findingReview, {});
}

export function bindScanReviewSystemContext() {
	return bindJapanese(PROMPT_KEYS.scanReview, {});
}

export function bindReportSummarySystemContext() {
	return bindJapanese(PROMPT_KEYS.reportSummary, {});
}

export function bindFindingReviewUserMessage(
	bundle: ReviewInputBundle,
): PromptInvocation<"reviews.findingReviewInput", "user"> {
	const { sourceSnippet, ...findingBundle } = bundle;
	return bindJapanese(PROMPT_KEYS.findingReviewInput, {
		bundle: toJsonValue(findingBundle),
		sourceSnippet,
	});
}

export function bindScanReviewUserMessage(
	bundle: ScanReviewBundle,
): PromptInvocation<"scans.scanReviewInput", "user"> {
	return bindJapanese(PROMPT_KEYS.scanReviewInput, {
		bundle: toJsonValue(bundle),
	});
}

export function bindReportSummaryUserMessage(
	bundle: ScanReviewBundle,
): PromptInvocation<"scans.reportSummaryInput", "user"> {
	return bindJapanese(PROMPT_KEYS.reportSummaryInput, {
		bundle: toJsonValue(bundle),
	});
}
