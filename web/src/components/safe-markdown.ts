import { sanitizeUntrustedHtml } from "../../../shared/html-sanitization";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const markdownRenderer = new marked.Renderer();
const renderSafeLink = markdownRenderer.link.bind(markdownRenderer);

const isSafeLink = (href: string): boolean => {
	if (href.includes("&") || href.startsWith("//")) return false;
	try {
		return ["http:", "https:", "mailto:"].includes(
			new URL(href, "https://markdown.local/").protocol,
		);
	} catch {
		return false;
	}
};

markdownRenderer.html = () => "";
markdownRenderer.image = () => "";
markdownRenderer.link = (token) => {
	const href = token.href.trim();
	if (!isSafeLink(href)) {
		return markdownRenderer.parser.parseInline(token.tokens);
	}
	return renderSafeLink(token);
};

/** Renders report Markdown with raw HTML, image tags and unsafe schemes disabled. */
export const renderMarkdownToSafeHtml = (markdown: string): string => {
	const rendered = marked.parse(markdown, {
		async: false,
		breaks: false,
		gfm: true,
		renderer: markdownRenderer,
	});
	return sanitizeUntrustedHtml(
		typeof rendered === "string" ? rendered : "",
		sanitizeHtml,
		{
			allowedTags: [
				"p",
				"br",
				"hr",
				"h1",
				"h2",
				"h3",
				"h4",
				"h5",
				"h6",
				"blockquote",
				"ul",
				"ol",
				"li",
				"strong",
				"em",
				"del",
				"pre",
				"code",
				"a",
				"table",
				"thead",
				"tbody",
				"tr",
				"th",
				"td",
			],
			allowedAttributes: {
				a: ["href", "title"],
				code: ["class"],
				th: ["align"],
				td: ["align"],
				ol: ["start"],
			},
			allowedSchemes: ["http", "https", "mailto"],
			allowProtocolRelative: false,
		},
	);
};
