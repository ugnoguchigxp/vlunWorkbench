import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

type DialogProps = {
	open: boolean;
	title: string;
	children: ReactNode;
	onClose: () => void;
	className?: string;
};

export function Dialog({
	open,
	title,
	children,
	onClose,
	className,
}: DialogProps) {
	const titleId = useId();
	const contentRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);

	useEffect(() => {
		onCloseRef.current = onClose;
	}, [onClose]);

	useEffect(() => {
		if (!open) return;
		const previousFocus = document.activeElement as HTMLElement | null;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = contentRef.current?.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			);
			if (!focusable?.length) {
				event.preventDefault();
				return;
			}
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		queueMicrotask(() => {
			const firstFocusable = contentRef.current?.querySelector<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			);
			(firstFocusable ?? contentRef.current)?.focus();
		});
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			previousFocus?.focus();
		};
	}, [open]);

	if (!open || typeof document === "undefined") return null;
	return createPortal(
		<div className="workspace-dialog-backdrop" role="presentation">
			<div
				ref={contentRef}
				className={["workspace-dialog", className ?? ""]
					.filter(Boolean)
					.join(" ")}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				tabIndex={-1}
			>
				<h2 id={titleId}>{title}</h2>
				{children}
			</div>
		</div>,
		document.body,
	);
}
