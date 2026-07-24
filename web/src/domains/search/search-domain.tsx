import { Search, Sparkles } from "lucide-react";
import mermaid from "mermaid";
import { MarkdownEditor } from "markdown-wysiwyg-editor";
import { useEffect, useMemo, useState } from "react";
import {
	agenticSearch,
	type AgenticSearchResult,
	type RetrievedFragment,
	type WebSearchResult,
	fetchSourcePage,
	searchFragments,
} from "../../api";
import {
	dedupeAgenticSourceCitations,
	normalizeAgenticAnswerMarkdown,
	toAgenticSourceKey,
	toAgenticSourceLabel,
} from "../../agentic-markdown";
import { Button, SelectInput, TextInput } from "../../ui";
import { useKnowledgeNavigation } from "../knowledge/knowledge-navigation";

type SearchResultsState = {
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

type SearchDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	availableCategories: string[];
};

const formatScore = (value: number | undefined): string =>
	typeof value === "number" ? value.toFixed(4) : "-";

const toResultTitle = (item: RetrievedFragment): string =>
	item.heading && item.heading.trim().length > 0
		? item.heading
		: item.sourceUri;

const toWebSearchLabel = (provider: string | null | undefined): string => {
	if (provider === "exa") return "Exa Search";
	if (provider === "brave") return "Brave Search";
	return "Web Search";
};

export const SearchDomainSection = ({
	active,
	busy,
	runWithBusy,
	availableCategories,
}: SearchDomainSectionProps) => {
	const { openKnowledge } = useKnowledgeNavigation();
	const [searchCategory, setSearchCategory] = useState("tech");
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SearchResultsState | null>(
		null,
	);
	const [agenticResult, setAgenticResult] =
		useState<AgenticSearchResult | null>(null);
	const [citationTitleBySlug, setCitationTitleBySlug] = useState<
		Record<string, string>
	>({});

	const agenticSourceCitations = useMemo(
		() =>
			agenticResult
				? dedupeAgenticSourceCitations(agenticResult.citations)
				: [],
		[agenticResult],
	);
	const agenticAnswerMarkdown = useMemo(
		() =>
			agenticResult ? normalizeAgenticAnswerMarkdown(agenticResult.answer) : "",
		[agenticResult],
	);

	useEffect(() => {
		if (availableCategories.includes(searchCategory)) return;
		if (availableCategories.includes("tech")) {
			setSearchCategory("tech");
			return;
		}
		setSearchCategory(availableCategories[0] ?? "tech");
	}, [availableCategories, searchCategory]);

	useEffect(() => {
		if (!agenticResult) {
			setCitationTitleBySlug({});
			return;
		}

		const wikiSlugs = Array.from(
			new Set(
				agenticResult.citations
					.map((citation) => citation.wikiSlug)
					.filter((slug): slug is string => Boolean(slug)),
			),
		);
		if (wikiSlugs.length === 0) {
			setCitationTitleBySlug({});
			return;
		}

		let cancelled = false;
		void (async () => {
			const pages = await Promise.allSettled(
				wikiSlugs.map(async (slug) => ({
					slug,
					page: await fetchSourcePage(slug),
				})),
			);
			if (cancelled) return;

			const titleBySlug: Record<string, string> = {};
			for (const result of pages) {
				if (result.status !== "fulfilled") continue;
				const title = result.value.page.title.trim();
				if (title) {
					titleBySlug[result.value.slug] = title;
				}
			}
			setCitationTitleBySlug(titleBySlug);
		})();

		return () => {
			cancelled = true;
		};
	}, [agenticResult]);

	const handleSearchFragments = async () => {
		const query = searchQuery.trim();
		setAgenticResult(null);
		if (!query) {
			setSearchResults(null);
			return;
		}
		await runWithBusy(async () => {
			const response = await searchFragments({
				query,
				topK: 12,
				category: searchCategory === "all" ? undefined : searchCategory,
			});
			setSearchResults({
				strategy: response.strategy,
				selectedResults: response.selectedResults,
				vectorResults: response.vectorResults,
				textResults: response.textResults,
				webResults: response.webResults,
				webSearch: response.webSearch,
				mergedResults: response.mergedResults,
			});
		});
	};

	const handleAgenticSearch = async () => {
		const query = searchQuery.trim();
		setSearchResults(null);
		if (!query) {
			setAgenticResult(null);
			return;
		}
		await runWithBusy(async () => {
			const response = await agenticSearch({
				query,
				topK: 8,
				category: searchCategory === "all" ? undefined : searchCategory,
			});
			setAgenticResult(response);
		});
	};

	const handleSearchCategoryChange = (value: string) => {
		setSearchCategory(value);
		setSearchResults(null);
		setAgenticResult(null);
	};

	const handleSearchQueryChange = (value: string) => {
		setSearchQuery(value);
		setSearchResults(null);
		setAgenticResult(null);
	};

	const renderSearchResult = (
		item: RetrievedFragment,
		kind: "text" | "vector",
	) => {
		const primaryLabel = kind === "text" ? "text" : "vector";
		const primaryScore = kind === "text" ? item.textScore : item.vectorScore;
		const secondaryLabel = kind === "text" ? "vector" : "text";
		const secondaryScore = kind === "text" ? item.vectorScore : item.textScore;
		const resultTitle = toResultTitle(item);
		return (
			<article className="google-result">
				<div className="google-result-attribution">
					<span className="google-result-category">{item.sourceCategory}</span>
					<span className="google-result-uri">{item.sourceUri}</span>
					<span className="google-result-locator">{item.locator}</span>
				</div>
				<h4>
					{item.wikiSlug ? (
						<button
							type="button"
							className="google-result-title-link"
							onClick={() => {
								if (item.wikiSlug) openKnowledge(item.wikiSlug);
							}}
							title={`Open wiki page: ${item.wikiSlug}`}
						>
							{resultTitle}
						</button>
					) : (
						<span className="google-result-title-disabled">{resultTitle}</span>
					)}
				</h4>
				<p>{item.content}</p>
				<div className="google-result-meta">
					<span>
						{primaryLabel}={formatScore(primaryScore)}
					</span>
					<span>
						{secondaryLabel}={formatScore(secondaryScore)}
					</span>
					<span>combined={formatScore(item.combinedScore)}</span>
					{item.sourceHitCount && item.sourceHitCount > 1 ? (
						<span>chunks={item.sourceHitCount}</span>
					) : null}
				</div>
				<div className="google-result-links">
					{item.wikiSlug ? (
						<button
							type="button"
							className="google-link-btn"
							onClick={() => {
								if (item.wikiSlug) openKnowledge(item.wikiSlug);
							}}
							title={`Open wiki page: ${item.wikiSlug}`}
						>
							wiki: {item.wikiSlug}
						</button>
					) : (
						<span className="google-link-disabled">wiki: unavailable</span>
					)}
					{item.wikiRawPath ? (
						<a
							href={item.wikiRawPath}
							target="_blank"
							rel="noreferrer"
							className="google-link-anchor"
							title="Open markdown document"
						>
							doc
						</a>
					) : (
						<span className="google-link-disabled">doc: unavailable</span>
					)}
				</div>
			</article>
		);
	};

	const renderWebSearchResult = (item: WebSearchResult) => {
		const title = item.title || item.url;
		return (
			<article className="google-result">
				<div className="google-result-attribution">
					<span className="google-result-category">web</span>
					<span className="google-result-uri">{item.url}</span>
					<span className="google-result-locator">#{item.position}</span>
				</div>
				<h4>
					<a
						href={item.url}
						target="_blank"
						rel="noreferrer"
						className="google-result-title-anchor"
					>
						{title}
					</a>
				</h4>
				<p>{item.snippet || "(no snippet)"}</p>
				<div className="google-result-links">
					<a
						href={item.url}
						target="_blank"
						rel="noreferrer"
						className="google-link-anchor"
					>
						open
					</a>
				</div>
			</article>
		);
	};

	if (!active) return null;

	return (
		<main className="layout columns-1">
			<section className="panel">
				<div className="panel-header">
					<h2>Fragment Search</h2>
				</div>
				<div className="search-row-advanced">
					<SelectInput
						value={searchCategory}
						onChange={(event) => handleSearchCategoryChange(event.target.value)}
						className="search-select"
					>
						<option value="all">All categories</option>
						{availableCategories.map((category) => (
							<option key={category} value={category}>
								{category}
							</option>
						))}
					</SelectInput>
					<div className="search-input-wrapper">
						<TextInput
							value={searchQuery}
							onChange={(event) => handleSearchQueryChange(event.target.value)}
							placeholder="Search knowledge fragments..."
							className="search-input"
						/>
					</div>
					<Button
						type="button"
						variant="primary"
						className="search-btn"
						onClick={() => void handleSearchFragments()}
						disabled={busy}
					>
						<Search className="icon" />
						<span>Search</span>
					</Button>
					<Button
						type="button"
						variant="secondary"
						className="search-btn btn-agentic"
						onClick={() => void handleAgenticSearch()}
						disabled={busy}
					>
						<Sparkles className="icon" />
						<span>Agentic Search</span>
					</Button>
				</div>
				<div className="list search-list">
					{agenticResult ? (
						<section className="artifact-row">
							<header>
								<strong>Agentic Answer</strong>
								<small>{agenticResult.query}</small>
							</header>
							<div className="agentic-answer-viewer">
								<MarkdownEditor
									value={agenticAnswerMarkdown}
									editable={false}
									enableMermaid={true}
									mermaidLib={mermaid}
									toolbarMode="hidden"
									autoHeight={true}
									className="wysiwyg-viewer"
								/>
							</div>
							<div className="search-results-summary">
								<span>sources={agenticSourceCitations.length}</span>
								<span>toolCalls={agenticResult.toolTrace.length}</span>
								{agenticResult.usage ? (
									<span>tokens={agenticResult.usage.totalTokens}</span>
								) : null}
							</div>
							{agenticSourceCitations.length > 0 ? (
								<ul className="citation-list">
									{agenticSourceCitations.map((citation) => {
										const key = toAgenticSourceKey(citation);
										const label = citation.wikiSlug
											? (citationTitleBySlug[citation.wikiSlug] ??
												toAgenticSourceLabel(citation))
											: toAgenticSourceLabel(citation);
										return (
											<li key={key}>
												{citation.wikiSlug ? (
													<button
														type="button"
														className="google-link-btn"
														onClick={() => {
															if (citation.wikiSlug) {
																openKnowledge(citation.wikiSlug);
															}
														}}
													>
														{label}
													</button>
												) : citation.url ? (
													<a
														href={citation.url}
														target="_blank"
														rel="noreferrer"
														className="google-link-anchor"
													>
														{label}
													</a>
												) : (
													<span>{label}</span>
												)}
											</li>
										);
									})}
								</ul>
							) : null}
							{agenticResult.toolTrace.length > 0 ? (
								<div className="list compact">
									{agenticResult.toolTrace.map((trace) => (
										<div
											key={`${trace.tool}-${trace.status}-${trace.elapsedMs}-${trace.resultCount ?? ""}-${trace.message ?? ""}`}
											className="list-item"
										>
											<div>
												{trace.tool} ({trace.status})
											</div>
											<small>
												elapsed={trace.elapsedMs}ms results=
												{trace.resultCount ?? "-"}
											</small>
											{trace.message ? <small>{trace.message}</small> : null}
										</div>
									))}
								</div>
							) : null}
						</section>
					) : null}
					{searchResults ? (
						<div className="search-results-grid">
							<div className="search-results-summary">
								<span>strategy={searchResults.strategy}</span>
								<span>selected={searchResults.selectedResults.length}</span>
								<span>merged={searchResults.mergedResults.length}</span>
								<span>web={searchResults.webResults.length}</span>
							</div>
							<section className="search-results-column">
								<header className="search-results-column-header">
									<h3>Full-text Search</h3>
									<small>{searchResults.textResults.length} hits</small>
								</header>
								<div className="search-results-column-list">
									{searchResults.textResults.length > 0 ? (
										searchResults.textResults.map((item) => (
											<div key={`text-${item.id}`}>
												{renderSearchResult(item, "text")}
											</div>
										))
									) : (
										<div className="tree-info">No full-text hits.</div>
									)}
								</div>
							</section>
							<section className="search-results-column">
								<header className="search-results-column-header">
									<h3>Vector Search</h3>
									<small>{searchResults.vectorResults.length} hits</small>
								</header>
								<div className="search-results-column-list">
									{searchResults.vectorResults.length > 0 ? (
										searchResults.vectorResults.map((item) => (
											<div key={`vector-${item.id}`}>
												{renderSearchResult(item, "vector")}
											</div>
										))
									) : (
										<div className="tree-info">No vector hits.</div>
									)}
								</div>
							</section>
							<section className="search-results-column">
								<header className="search-results-column-header">
									<h3>{toWebSearchLabel(searchResults.webSearch.provider)}</h3>
									<small>{searchResults.webResults.length} hits</small>
								</header>
								<div className="search-results-column-list">
									{searchResults.webResults.length > 0 ? (
										searchResults.webResults.map((item) => (
											<div key={`web-${item.url}`}>
												{renderWebSearchResult(item)}
											</div>
										))
									) : (
										<div className="tree-info">
											{searchResults.webSearch.available
												? (searchResults.webSearch.message ??
													`No ${toWebSearchLabel(searchResults.webSearch.provider)} hits.`)
												: (searchResults.webSearch.unavailableMessage ??
													`${toWebSearchLabel(searchResults.webSearch.provider)} is not configured.`)}
										</div>
									)}
								</div>
							</section>
						</div>
					) : (
						<div className="tree-info">
							Run search to compare full-text, vector, and web search results
							side by side.
						</div>
					)}
				</div>
			</section>
		</main>
	);
};
