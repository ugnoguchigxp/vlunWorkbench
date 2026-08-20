import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

const MenuCloseContext = createContext<(() => void) | null>(null);

type MenuProps = {
	label: string;
	children: ReactNode;
};

export function Menu({ label, children }: MenuProps) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const closeEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", closeOutside);
		document.addEventListener("keydown", closeEscape);
		return () => {
			document.removeEventListener("mousedown", closeOutside);
			document.removeEventListener("keydown", closeEscape);
		};
	}, [open]);

	return (
		<div ref={rootRef} className="workspace-menu">
			<button
				type="button"
				className="workspace-menu-trigger"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				{label}
			</button>
			{open ? (
				<MenuCloseContext.Provider value={() => setOpen(false)}>
					<div className="workspace-menu-popover" role="menu">
						{children}
					</div>
				</MenuCloseContext.Provider>
			) : null}
		</div>
	);
}

export function MenuItem({
	children,
	onSelect,
	danger = false,
}: {
	children: ReactNode;
	onSelect: () => void;
	danger?: boolean;
}) {
	const closeMenu = useContext(MenuCloseContext);
	return (
		<button
			type="button"
			role="menuitem"
			className={danger ? "workspace-menu-item danger" : "workspace-menu-item"}
			onClick={() => {
				onSelect();
				closeMenu?.();
			}}
		>
			{children}
		</button>
	);
}
