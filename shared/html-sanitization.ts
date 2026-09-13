import type sanitizeHtml from "sanitize-html";

/** One final HTML boundary for report and wiki renderers; callers narrow tags/attributes. */
export function sanitizeUntrustedHtml(
	html: string,
	sanitizer: typeof sanitizeHtml,
	options: sanitizeHtml.IOptions,
): string {
	return sanitizer(html, {
		...options,
		allowedSchemes: ["http", "https", "mailto"],
		allowProtocolRelative: false,
	});
}
