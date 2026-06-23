import { MarkdownTipTapConverter } from "markdown-wysiwyg-editor";
import { describe, expect, it } from "vitest";
import type { AgenticSearchCitation } from "./api";
import {
	dedupeAgenticSourceCitations,
	normalizeAgenticAnswerMarkdown,
} from "./agentic-markdown";

describe("normalizeAgenticAnswerMarkdown", () => {
	it("prevents markdown-wysiwyg inline code placeholders from leaking inside bold text", async () => {
		const markdown =
			"- **`biome.jsonc` から始める**\n- CI では `biome ci .` を使う";

		const normalized = normalizeAgenticAnswerMarkdown(markdown);
		const json =
			await MarkdownTipTapConverter.markdownToTipTapJson(normalized);
		const serialized = JSON.stringify(json);

		expect(serialized).not.toContain("§CODE§");
		expect(serialized).toContain("biome.jsonc");
		expect(serialized).toContain("biome ci .");
		expect(serialized).toContain('"type":"code"');
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
});
