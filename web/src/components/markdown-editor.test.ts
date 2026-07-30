import { describe, expect, it } from "vitest";
import { renderMarkdownToSafeHtml } from "./markdown-editor";

describe("renderMarkdownToSafeHtml", () => {
	it("renders common report Markdown including tables", () => {
		const html = renderMarkdownToSafeHtml(
			"# Report\n\n| Risk | Count |\n| --- | ---: |\n| High | 2 |",
		);

		expect(html).toContain("<h1>Report</h1>");
		expect(html).toContain("<table>");
		expect(html).toContain("<td");
	});

	it("keeps Mermaid fences inert as code", () => {
		const html = renderMarkdownToSafeHtml(
			"```mermaid\ngraph TD; A-->B\n```",
		);

		expect(html).toContain('<code class="language-mermaid">');
		expect(html).toContain("graph TD; A--&gt;B");
		expect(html).not.toContain("<svg");
	});

	it("removes active HTML and unsafe link schemes", () => {
		const html = renderMarkdownToSafeHtml(
			[
				'<script>alert(1)</script>',
				"[unsafe](javascript:alert(1))",
				"[encoded](javascript&colon;alert(1))",
				"![<img onerror=alert(1)>](https://example.com/image.png)",
			].join("\n"),
		);

		expect(html).not.toContain("<script");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("<img");
		expect(html).not.toContain("onerror=");
		expect(html).toContain("unsafe");
	});
});
