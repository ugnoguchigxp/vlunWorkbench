import { createAppCatalog } from "../../.s11tnext/catalog.generated";
import artifact from "../../.s11tnext/catalog.json" with { type: "json" };

export const promptCatalog = createAppCatalog(artifact);

export const PROMPT_KEYS = {
	agenticSearch: "agenticSearch.system",
	chatSearchDecision: "chat.searchDecision",
	chatDirectAnswer: "chat.directAnswer",
	chatGroundedAnswer: "chat.groundedAnswer",
	findingReview: "reviews.findingReview",
	findingReviewInput: "reviews.findingReviewInput",
	scanReview: "scans.scanReview",
	scanReviewInput: "scans.scanReviewInput",
	improvementRequest: "scans.improvementRequest",
	improvementRequestInput: "scans.improvementRequestInput",
	reportSummary: "scans.reportSummary",
	reportSummaryInput: "scans.reportSummaryInput",
} as const;

/** @deprecated Use promptCatalog. */
export const systemContextCatalog = promptCatalog;

/** @deprecated Use PROMPT_KEYS. */
export const SYSTEM_CONTEXT_KEYS = PROMPT_KEYS;
