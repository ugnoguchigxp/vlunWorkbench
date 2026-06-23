import type { SourceRepository } from "../../sources/source.repository";
import type { PageDocument } from "../../sources/wiki/content-repo";
import type { WebSearchProvider } from "../../../providers/types";
import type { SearchEvidenceCollector } from "../../rag/search-evidence";
import type {
	AgenticFunctionToolSpec,
	AgenticSearchCitation,
	AgenticToolExecution,
} from "../types";

export type AgenticToolDeps = {
	sourceRepository: SourceRepository;
	createEmbedding: (input: string) => Promise<number[]>;
	readWikiPage: (slug: string) => Promise<PageDocument | null>;
	evidenceCollector?: SearchEvidenceCollector;
	webSearchProvider?: WebSearchProvider;
	webSearchUnavailableMessage?: string;
	maxContextChars: number;
};

export type AgenticToolRuntimeContext = {
	query: string;
	category?: string;
	topK: number;
	fetchCount: number;
	maxFetchCalls: number;
	maxContextChars: number;
};

export type AgenticToolDefinition = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (
		rawArgs: unknown,
		deps: AgenticToolDeps,
		runtime: AgenticToolRuntimeContext,
	) => Promise<AgenticToolExecution>;
};

export type AgenticToolRegistryEntry = AgenticToolDefinition & {
	toSpec: () => AgenticFunctionToolSpec;
};

export function toWikiFragmentCitation(input: {
	title: string;
	sourceUri: string;
	locator: string;
	wikiSlug?: string | null;
}): AgenticSearchCitation {
	return {
		kind: "wiki_fragment",
		title: input.title,
		uri: input.sourceUri,
		locator: input.locator,
		wikiSlug: input.wikiSlug ?? null,
	};
}
