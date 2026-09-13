import { describe, expect, it } from "vitest";
import { renderMarkdownToSafeHtml } from "./safe-markdown";

describe("renderMarkdownToSafeHtml", () => {
	it("renders common report Markdown including tables", () => {
		const html = renderMarkdownToSafeHtml(
			"# Report\n\n| Risk | Count |\n| --- | ---: |\n| High | 2 |",
		);

		expect(html).toContain("<h1>Report</h1>");
		expect(html).toContain("<table>");
		expect(html).toContain("<td");
	});

	it("keeps safe code and links while rejecting malformed HTML and encoded schemes", () => {
		const html = renderMarkdownToSafeHtml([
			'<svg><g onload="alert(1)"></g></svg>',
			'<a href="javascript:alert(1)" onclick="alert(2)">raw</a>',
			'[entity](java&#x73;cript:alert(1))',
			'[relative-host](//attacker.invalid/path)',
			'[safe](https://example.com/report)',
			'`<script>alert(1)</script>`',
		].join("\n\n"));
		expect(html).not.toMatch(/<svg|onload=|onclick=|href="(?:javascript:|\/\/)/);
		expect(html).toContain('href="https://example.com/report"');
		expect(html).toContain('&lt;script&gt;');
	});

	it("removes active HTML, unsafe links and image tags", () => {
		const html = renderMarkdownToSafeHtml(
			[
				"<script>alert(1)</script>",
				"[unsafe](javascript:alert(1))",
				"[encoded](javascript&colon;alert(1))",
				"![image](https://example.com/image.png)",
			].join("\n"),
		);

		expect(html).not.toContain("<script");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("<img");
		expect(html).toContain("unsafe");
	});
});
