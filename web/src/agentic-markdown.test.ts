import { describe, expect, it } from "vitest";
import type { AgenticSearchCitation } from "./api";
import {
	dedupeAgenticSourceCitations,
	normalizeAgenticAnswerMarkdown,
	toAgenticSourceKey,
	toAgenticSourceLabel,
} from "./agentic-markdown";

describe("normalizeAgenticAnswerMarkdown", () => {
	it("normalizes inline code nested inside bold text", () => {
		const markdown =
			"- **`biome.jsonc` から始める**\n- CI では `biome ci .` を使う";

		const normalized = normalizeAgenticAnswerMarkdown(markdown);
		expect(normalized).toContain("**biome.jsonc から始める**");
		expect(normalized).toContain("`biome ci .`");
	});

	it("does not rewrite fenced code blocks", () => {
		const markdown = [
			"```ts",
			"const command = `biome ci .`;",
			"```",
			"- **`biome.jsonc` を使う**",
		].join("\n");

		expect(normalizeAgenticAnswerMarkdown(markdown)).toBe(
			[
				"```ts",
				"const command = `biome ci .`;",
				"```",
				"- **biome.jsonc を使う**",
			].join("\n"),
		);
	});

	it("unwraps inline code nested in strikethrough and italic text", () => {
		expect(
			normalizeAgenticAnswerMarkdown("~~`removed`~~ and *`emphasis`*"),
		).toBe("~~removed~~ and *emphasis*");
	});
});

describe("agentic source helpers", () => {
	it("prefers wiki, URL, URI, then a stable title key", () => {
		expect(
			toAgenticSourceKey({
				kind: "wiki_page",
				title: "Wiki",
				wikiSlug: "guide/start",
			}),
		).toBe("wiki:guide/start");
		expect(
			toAgenticSourceKey({ kind: "web_page", title: "Web", url: "https://example.com" }),
		).toBe("url:https://example.com");
		expect(
			toAgenticSourceKey({ kind: "wiki_fragment", title: "Fragment", uri: "guide#part" }),
		).toBe("uri:guide#part");
		expect(
			toAgenticSourceKey({ kind: "web_search_result", title: "Search" }),
		).toBe("title:web_search_result:Search");
	});

	it("uses the first available source label", () => {
		expect(toAgenticSourceLabel({ kind: "web_page", title: "Title", url: "url" })).toBe("Title");
		expect(toAgenticSourceLabel({ kind: "web_page", title: "", url: "url" })).toBe("url");
		expect(toAgenticSourceLabel({ kind: "web_page", title: "", uri: "uri" })).toBe("uri");
		expect(toAgenticSourceLabel({ kind: "web_page", title: "" })).toBe("Source");
	});
});

describe("dedupeAgenticSourceCitations", () => {
	it("collapses chunk citations to one source-level citation", () => {
		const citations: AgenticSearchCitation[] = [
			{
				kind: "wiki_fragment",
				title: "Biome chunk",
				uri: "tech/biome.md#chunk-1",
				wikiSlug: "tech/biome",
			},
			{
				kind: "wiki_page",
				title: "Biome ベストプラクティス",
				uri: "tech/biome.md",
				wikiSlug: "tech/biome",
			},
		];

		expect(dedupeAgenticSourceCitations(citations)).toEqual([
			citations[1],
		]);
	});

	it("replaces a lower-ranked citation with a page citation", () => {
		const fragment: AgenticSearchCitation = {
			kind: "wiki_fragment",
			title: "Chunk",
			uri: "guide.md#chunk",
			wikiSlug: "guide",
		};
		const page: AgenticSearchCitation = {
			kind: "wiki_page",
			title: "Guide",
			uri: "guide.md",
			wikiSlug: "guide",
		};
		expect(dedupeAgenticSourceCitations([fragment, page])).toEqual([page]);
	});
});
