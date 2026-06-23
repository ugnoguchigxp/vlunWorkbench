import type { EvidenceWebResult } from "../rag/search-evidence";
import type { RetrievedFragment } from "../rag/types";

export type AgenticCitationKind =
	| "wiki_fragment"
	| "wiki_page"
	| "web_search_result"
	| "web_page";

export type AgenticSearchCitation = {
	kind: AgenticCitationKind;
	title: string;
	uri?: string;
	url?: string;
	locator?: string;
	wikiSlug?: string | null;
};

export type AgenticToolTraceStatus = "ok" | "error" | "skipped";

export type AgenticToolTrace = {
	tool: string;
	status: AgenticToolTraceStatus;
	elapsedMs: number;
	resultCount?: number;
	message?: string;
	turn?: number;
	callId?: string;
};

export type AgenticUsage = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
};

export type AgenticSearchResult = {
	query: string;
	answer: string;
	citations: AgenticSearchCitation[];
	toolTrace: AgenticToolTrace[];
	retrieved?: RetrievedFragment[];
	webResults?: EvidenceWebResult[];
	usage?: AgenticUsage;
};

export type AgenticSearchRequest = {
	query: string;
	category?: string;
	topK: number;
	systemContext: string;
};

export type AgenticSearchRunOptions = {
	maxToolCalls: number;
	maxFetchCalls: number;
	maxContextChars: number;
};

export type AgenticToolExecution = {
	output: unknown;
	citations?: AgenticSearchCitation[];
	retrieved?: RetrievedFragment[];
	webResults?: EvidenceWebResult[];
	resultCount?: number;
};

export type AgenticFunctionCall = {
	callId: string;
	name: string;
	argumentsJson: string;
};

export type AgenticFunctionToolSpec = {
	type: "function";
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

export type AgenticLlmTurnResult = {
	text: string;
	functionCalls: AgenticFunctionCall[];
	usage?: AgenticUsage;
};
