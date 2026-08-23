import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FindingDescriptionMarkdown } from "./finding-detail-overview";

describe("FindingDescriptionMarkdown", () => {
	it("renders a long finding description as structured Markdown", () => {
		const markup = renderToStaticMarkup(
			createElement(FindingDescriptionMarkdown, {
				value: [
					"DoS via unbounded expansion length causing an out-of-memory crash",
					"",
					"### Summary",
					"`expand()` bounds the **number** of results but not their *length*.",
					"",
					"### Details",
					"- The result count is capped at `max`.",
					"- Every result continues to grow with the number of groups.",
				].join("\n"),
			}),
		);

		expect(markup).toContain("finding-description-markdown");
		expect(markup).toContain("<h3>Summary</h3>");
		expect(markup).toContain("<strong>number</strong>");
		expect(markup).toContain("<code>expand()</code>");
		expect(markup).toContain("<ul>");
		expect(markup).not.toContain("### Summary");
	});

	it("keeps active HTML and unsafe links out of the drawer", () => {
		const markup = renderToStaticMarkup(
			createElement(FindingDescriptionMarkdown, {
				value: [
					"<script>alert(1)</script>",
					"[unsafe](javascript:alert(1))",
				].join("\n\n"),
			}),
		);

		expect(markup).not.toContain("<script");
		expect(markup).not.toContain("javascript:");
		expect(markup).toContain("unsafe");
	});
});
