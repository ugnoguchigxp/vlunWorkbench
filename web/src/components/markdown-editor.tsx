import {
	type ChangeEvent,
	type MouseEvent,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { renderMarkdownToSafeHtml } from "./safe-markdown";

type MarkdownEditorProps = {
	value: string;
	onChange?: (value: string) => void;
	editable?: boolean;
	toolbarMode?: "fixed" | "hidden";
	enableVerticalScroll?: boolean;
	autoHeight?: boolean;
	className?: string;
};

export { renderMarkdownToSafeHtml } from "./safe-markdown";

const joinClassNames = (
	...values: Array<string | false | null | undefined>
): string => values.filter(Boolean).join(" ");

export function MarkdownEditor({
	value,
	onChange,
	editable = true,
	toolbarMode = "fixed",
	enableVerticalScroll = false,
	autoHeight = false,
	className,
}: MarkdownEditorProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const safeHtml = useMemo(
		() => (editable ? renderMarkdownToSafeHtml(value) : ""),
		[editable, value],
	);

	const updateValue = useCallback(
		(nextValue: string) => {
			if (editable) onChange?.(nextValue);
		},
		[editable, onChange],
	);

	const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
		updateValue(event.target.value);
	};

	const insertMarkup = useCallback(
		(prefix: string, suffix: string, placeholder: string) => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			const selectionStart = textarea.selectionStart;
			const selectionEnd = textarea.selectionEnd;
			const selected = value.slice(selectionStart, selectionEnd) || placeholder;
			const nextValue = `${value.slice(0, selectionStart)}${prefix}${selected}${suffix}${value.slice(selectionEnd)}`;
			updateValue(nextValue);
			const nextSelectionStart = selectionStart + prefix.length;
			queueMicrotask(() => {
				textarea.focus();
				textarea.setSelectionRange(
					nextSelectionStart,
					nextSelectionStart + selected.length,
				);
			});
		},
		[updateValue, value],
	);

	const preventToolbarBlur = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
	};

	if (!editable) {
		return (
			<MarkdownRenderer
				markdown={value}
				className={joinClassNames(
					autoHeight && "markdown-surface-auto-height",
					className,
				)}
			/>
		);
	}

	return (
		<div
			className={joinClassNames(
				"markdown-surface",
				enableVerticalScroll && "markdown-surface-scroll",
				autoHeight && "markdown-surface-auto-height",
				className,
			)}
		>
			{toolbarMode !== "hidden" ? (
				<div
					className="markdown-toolbar"
					role="toolbar"
					aria-label="Markdown formatting"
				>
					<button
						type="button"
						onMouseDown={preventToolbarBlur}
						onClick={() => insertMarkup("## ", "", "Heading")}
						aria-label="Insert heading"
					>
						H2
					</button>
					<button
						type="button"
						onMouseDown={preventToolbarBlur}
						onClick={() => insertMarkup("**", "**", "bold")}
						aria-label="Insert bold text"
					>
						<strong>B</strong>
					</button>
					<button
						type="button"
						onMouseDown={preventToolbarBlur}
						onClick={() => insertMarkup("_", "_", "italic")}
						aria-label="Insert italic text"
					>
						<em>I</em>
					</button>
					<button
						type="button"
						onMouseDown={preventToolbarBlur}
						onClick={() => insertMarkup("`", "`", "code")}
						aria-label="Insert inline code"
					>
						Code
					</button>
					<button
						type="button"
						onMouseDown={preventToolbarBlur}
						onClick={() => insertMarkup("[", "](https://)", "link text")}
						aria-label="Insert link"
					>
						Link
					</button>
					<button
						type="button"
						onMouseDown={preventToolbarBlur}
						onClick={() => insertMarkup("- ", "", "list item")}
						aria-label="Insert list item"
					>
						List
					</button>
				</div>
			) : null}
			<div className="markdown-edit-grid">
				<label className="markdown-source">
					<span className="sr-only">Markdown source</span>
					<textarea
						ref={textareaRef}
						value={value}
						onChange={handleChange}
						spellCheck
						aria-label="Markdown source"
					/>
				</label>
				<section
					className="markdown-preview markdown-document"
					aria-label="Markdown preview"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: raw HTML and unsafe links are disabled by the Marked renderer.
					dangerouslySetInnerHTML={{ __html: safeHtml }}
				/>
			</div>
		</div>
	);
}
