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
