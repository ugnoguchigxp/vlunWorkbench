import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./markdown-renderer";

describe("MarkdownRenderer", () => {
	it("renders headings, lists, emphasis and fenced code as HTML", () => {
		const markup = renderToStaticMarkup(
			createElement(MarkdownRenderer, {
				markdown: [
					"# 改修指示書",
					"",
					"## 対象範囲",
					"",
					"- **認証処理**を修正する",
					"",
					"```bash",
					"bun test",
					"```",
				].join("\n"),
				ariaLabel: "指示書プレビュー",
			}),
		);

		expect(markup).toContain(
			'class="markdown-surface-viewer markdown-document"',
		);
		expect(markup).toContain("aria-label=\"指示書プレビュー\"");
		expect(markup).toContain("<h1>改修指示書</h1>");
		expect(markup).toContain("<h2>対象範囲</h2>");
		expect(markup).toContain("<ul>");
		expect(markup).toContain("<strong>認証処理</strong>");
		expect(markup).toContain("<pre><code class=\"language-bash\">bun test");
		expect(markup).not.toContain("# 改修指示書");
	});

	it("does not render raw HTML, images or unsafe links", () => {
		const markup = renderToStaticMarkup(
			createElement(MarkdownRenderer, {
				markdown:
					'<script>alert(1)</script>\n\n![x](https://example.com/x.png)\n\n[実行](javascript:alert(1))',
			}),
		);

		expect(markup).not.toContain("<script");
		expect(markup).not.toContain("<img");
		expect(markup).not.toContain("javascript:");
		expect(markup).toContain("実行");
	});
});
