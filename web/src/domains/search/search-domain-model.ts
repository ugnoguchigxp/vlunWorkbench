import type { RetrievedFragment, WebSearchResult } from "../../api";

export type SearchResultsState = {
	strategy: "merged" | "text_fallback" | "legacy_retrieve";
	selectedResults: RetrievedFragment[];
	vectorResults: RetrievedFragment[];
	textResults: RetrievedFragment[];
	webResults: WebSearchResult[];
	webSearch: {
		available: boolean;
		provider: string | null;
		message: string | null;
		unavailableMessage: string | null;
	};
	mergedResults: RetrievedFragment[];
};

export const formatSearchScore = (value: number | undefined): string =>
	typeof value === "number" ? value.toFixed(4) : "-";

export const searchResultTitle = (item: RetrievedFragment): string =>
	item.heading && item.heading.trim().length > 0
		? item.heading
		: item.sourceUri;

export const webSearchProviderLabel = (
	provider: string | null | undefined,
): string => {
	if (provider === "exa") return "Exa Search";
	if (provider === "brave") return "Brave Search";
	return "Web Search";
};
