import { marked } from "marked";

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
	return typeof rendered === "string" ? rendered : "";
};
