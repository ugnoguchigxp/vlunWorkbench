import { useMemo } from "react";
import { renderMarkdownToSafeHtml } from "./safe-markdown";

type MarkdownRendererProps = {
	markdown: string;
	className?: string;
	ariaLabel?: string;
};

const joinClassNames = (
	...values: Array<string | false | null | undefined>
): string => values.filter(Boolean).join(" ");

/** Displays Markdown as a sanitized, read-only HTML document. */
export function MarkdownRenderer({
	markdown,
	className,
	ariaLabel,
}: MarkdownRendererProps) {
	const safeHtml = useMemo(
		() => renderMarkdownToSafeHtml(markdown),
		[markdown],
	);

	return (
		<article
			className={joinClassNames(
				"markdown-surface-viewer",
				"markdown-document",
				className,
			)}
			aria-label={ariaLabel}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: raw HTML, images and unsafe links are disabled by the shared Marked renderer.
			dangerouslySetInnerHTML={{ __html: safeHtml }}
		/>
	);
}
