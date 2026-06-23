import type { AgenticSearchCitation } from "./api";

const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;

const unwrapInlineCode = (value: string): string =>
	value.replace(INLINE_CODE_PATTERN, "$1");

const unwrapNestedInlineCode = (line: string): string =>
	line
		.replace(/\*\*([^*\n]*`[^`\n]+`[^*\n]*)\*\*/g, (_match, body) => {
			return `**${unwrapInlineCode(String(body))}**`;
		})
		.replace(/~~([^~\n]*`[^`\n]+`[^~\n]*)~~/g, (_match, body) => {
			return `~~${unwrapInlineCode(String(body))}~~`;
		})
		.replace(
			/(^|[^*])\*([^*\n]*`[^`\n]+`[^*\n]*)\*/g,
			(_match, prefix, body) => {
				return `${String(prefix)}*${unwrapInlineCode(String(body))}*`;
			},
		);

export const normalizeAgenticAnswerMarkdown = (markdown: string): string => {
	const lines = markdown.split(/\r?\n/);
	let inFence = false;
	const normalized = lines.map((line) => {
		if (line.trimStart().startsWith("```")) {
			inFence = !inFence;
			return line;
		}
		if (inFence) {
			return line;
		}
		return unwrapNestedInlineCode(line);
	});
	return normalized.join("\n");
};

export const toAgenticSourceKey = (citation: AgenticSearchCitation): string => {
	if (citation.wikiSlug) return `wiki:${citation.wikiSlug}`;
	if (citation.url) return `url:${citation.url}`;
	if (citation.uri) return `uri:${citation.uri}`;
	return `title:${citation.kind}:${citation.title}`;
};

export const toAgenticSourceLabel = (citation: AgenticSearchCitation): string =>
	citation.title || citation.uri || citation.url || "Source";

export const dedupeAgenticSourceCitations = (
	citations: AgenticSearchCitation[],
): AgenticSearchCitation[] => {
	const rank = (citation: AgenticSearchCitation): number =>
		citation.kind === "wiki_page" || citation.kind === "web_page" ? 2 : 1;
	const result: AgenticSearchCitation[] = [];
	for (const citation of citations) {
		const key = toAgenticSourceKey(citation);
		const existingIndex = result.findIndex(
			(item) => toAgenticSourceKey(item) === key,
		);
		if (existingIndex >= 0) {
			const existing = result[existingIndex];
			if (existing && rank(citation) > rank(existing)) {
				result[existingIndex] = citation;
			}
			continue;
		}
		result.push(citation);
	}
	return result;
};
