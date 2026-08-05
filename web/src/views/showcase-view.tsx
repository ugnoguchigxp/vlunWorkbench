import {
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
	type ColumnDef,
	type SortingState,
} from "@tanstack/react-table";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	Bell,
	Calendar,
	Check,
	ChevronDown,
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	Copy,
	CreditCard,
	FileText,
	Folder,
	Grid2X2,
	Info,
	List,
	LoaderCircle,
	Mail,
	MoreHorizontal,
	PanelRight,
	Search,
	Settings,
	ShieldCheck,
	SlidersHorizontal,
	Star,
	X,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import {
	showcaseDensityOptions,
	showcaseFontSizeOptions,
	showcaseRadiusOptions,
	showcaseThemeOptions,
	type ShowcaseDensity,
	type ShowcaseFontSize,
	type ShowcaseRadius,
	type ShowcaseTheme,
	useShowcaseSettings,
} from "../showcase-settings-context";
import {
	isShowcaseSortField,
	showcaseTablePageSizes,
	type ShowcaseTableSearch,
} from "../showcase-table-search";

type ShowcaseRow = {
	component: string;
	category: string;
	status: string;
};

const visibleComponents = [
	"Button",
	"IconButton",
	"Badge",
	"Alert",
	"NotificationToast",
	"Card",
	"Avatar",
	"Input",
	"InputGroup",
	"InputOtp",
	"Textarea",
	"Select",
	"Combobox",
	"Checkbox",
	"RadioGroup",
	"Switch",
	"Tabs",
	"Breadcrumb",
	"Accordion",
	"DropdownMenu",
	"Pagination",
	"ViewSwitcher",
	"Dialog",
	"Drawer",
	"Popover",
	"Tooltip",
	"Progress",
	"Skeleton",
	"Spinner",
	"Table",
	"MiniTable",
	"List",
	"FileTree",
	"DateFormat",
	"NumberFormat",
] as const;

export function ShowcaseView() {
	return <ShowcaseContent />;
}

function ShowcaseContent() {
	const search = useSearch({ from: "/showcase" });
	const navigate = useNavigate({ from: "/showcase" });
	const [progress, setProgress] = useState(33);
	const [selectedFramework, setSelectedFramework] = useState("React");
	const [notificationsEnabled, setNotificationsEnabled] = useState(true);
	const [acceptedTerms, setAcceptedTerms] = useState(true);
	const [selectedPlan, setSelectedPlan] = useState("team");
	const [activeTab, setActiveTab] = useState<
		"account" | "password" | "settings"
	>("account");
	const [openAccordion, setOpenAccordion] = useState("tokens");
	const [menuOpen, setMenuOpen] = useState(false);
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [activePage, setActivePage] = useState(2);
	const [activeView, setActiveView] = useState<"grid" | "list">("grid");
	const [copied, setCopied] = useState(false);
	const {
		settings,
		setTheme,
		setDensity,
		setRadius,
		setFontSize,
		resetSettings,
		showcaseStyle,
	} = useShowcaseSettings();
	const tableSorting = useMemo<SortingState>(
		() =>
			search.sortBy
				? [
						{
							id: search.sortBy,
							desc: search.sortDir === "desc",
						},
					]
				: [],
		[search.sortBy, search.sortDir],
	);

	const rows = useMemo<ShowcaseRow[]>(
		() =>
			visibleComponents.map((component) => ({
				component,
				category: getComponentCategory(component),
				status: getComponentStatus(component),
			})),
		[],
	);
	const columns = useMemo<ColumnDef<ShowcaseRow>[]>(
		() => [
			{ accessorKey: "component", header: "Component" },
			{ accessorKey: "category", header: "Category" },
			{ accessorKey: "status", header: "Status" },
		],
		[],
	);
	const table = useReactTable({
		data: rows,
		columns,
		state: {
			sorting: tableSorting,
			pagination: {
				pageIndex: search.page - 1,
				pageSize: search.pageSize,
			},
		},
		onSortingChange: (updater) => {
			const nextSorting =
				typeof updater === "function" ? updater(tableSorting) : updater;
			const primarySort = nextSorting[0];
			if (!primarySort || !isShowcaseSortField(primarySort.id)) {
				void updateTableSearch({
					page: 1,
					sortBy: undefined,
					sortDir: undefined,
				});
				return;
			}
			void updateTableSearch({
				page: 1,
				sortBy: primarySort.id,
				sortDir: primarySort.desc ? "desc" : "asc",
			});
		},
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
	});
	const visiblePageNumbers = getVisiblePageNumbers(
		table.getPageCount(),
		search.page,
	);

	function updateTableSearch(nextSearch: Partial<ShowcaseTableSearch>) {
		const scrollPosition =
			typeof window === "undefined"
				? null
				: {
						x: window.scrollX,
						y: window.scrollY,
					};
		return navigate({
			replace: true,
			resetScroll: false,
			search: (previous) => ({
				...previous,
				...nextSearch,
			}),
		}).then(() => {
			if (!scrollPosition) {
				return;
			}
			window.requestAnimationFrame(() => {
				window.scrollTo(scrollPosition.x, scrollPosition.y);
			});
		});
	}

	return (
		<main
			className="showcase-shell component-showcase"
			style={showcaseStyle}
			data-showcase-theme={settings.theme}
			data-showcase-density={settings.density}
			data-showcase-radius={settings.radius}
			data-showcase-font-size={settings.fontSize}
		>
			<section className="component-showcase-header">
				<div className="showcase-kicker">
					<Grid2X2 className="icon" />
					<span>{visibleComponents.length} components</span>
				</div>
				<h1>Component Showcase</h1>
				<p>Demonstrating the components from the template design system.</p>
			</section>

			<section
				className="showcase-settings-panel"
				aria-labelledby="appearance-heading"
			>
				<div className="showcase-settings-header">
					<div>
						<h2 id="appearance-heading">Appearance Controls</h2>
						<p>Theme tokens persisted by React Context and localStorage.</p>
					</div>
					<button
						type="button"
						className="demo-button variant-outline"
						onClick={resetSettings}
					>
						Reset
					</button>
				</div>
				<div className="settings-grid">
					<label className="settings-field" htmlFor="showcase-theme">
						<span>Theme Color</span>
						<select
							id="showcase-theme"
							value={settings.theme}
							onChange={(event) =>
								setTheme(event.target.value as ShowcaseTheme)
							}
						>
							{showcaseThemeOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<div className="settings-field">
						<span>Density</span>
						<div className="settings-button-row">
							{showcaseDensityOptions.map((option) => (
								<button
									type="button"
									key={option.value}
									className={settings.density === option.value ? "active" : ""}
									aria-pressed={settings.density === option.value}
									onClick={() => setDensity(option.value as ShowcaseDensity)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
					<div className="settings-field">
						<span>Corner Radius</span>
						<div className="settings-button-row">
							{showcaseRadiusOptions.map((option) => (
								<button
									type="button"
									key={option.value}
									className={settings.radius === option.value ? "active" : ""}
									aria-pressed={settings.radius === option.value}
									onClick={() => setRadius(option.value as ShowcaseRadius)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
					<div className="settings-field">
						<span>Font Size</span>
						<div className="settings-button-row">
							{showcaseFontSizeOptions.map((option) => (
								<button
									type="button"
									key={option.value}
									className={settings.fontSize === option.value ? "active" : ""}
									aria-pressed={settings.fontSize === option.value}
									onClick={() => setFontSize(option.value as ShowcaseFontSize)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
				</div>
				<div className="theme-preview-row">
					{showcaseThemeOptions.map((option) => (
						<button
							type="button"
							key={option.value}
							className={
								settings.theme === option.value
									? "theme-swatch active"
									: "theme-swatch"
							}
							aria-label={option.label}
							aria-pressed={settings.theme === option.value}
							onClick={() => setTheme(option.value as ShowcaseTheme)}
							style={
								{
									"--swatch-color": option.swatch,
								} as CSSProperties & Record<"--swatch-color", string>
							}
						/>
					))}
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="actions-heading">
				<h2 id="actions-heading">Actions & Feedback</h2>
				<div className="button-row">
					<button type="button" className="demo-button primary">
						<Check className="icon" />
						Default
					</button>
					<button type="button" className="demo-button secondary">
						<Settings className="icon" />
						Secondary
					</button>
					<button type="button" className="demo-button destructive">
						<X className="icon" />
						Destructive
					</button>
					<button type="button" className="demo-button variant-outline">
						<SlidersHorizontal className="icon" />
						Outline
					</button>
					<button type="button" className="demo-button ghost">
						Ghost
					</button>
					<button type="button" className="demo-button link">
						Link
					</button>
					<button type="button" className="demo-button primary" disabled>
						Disabled
					</button>
					<button
						type="button"
						className="demo-icon-button"
						aria-label="More actions"
						title="More actions"
					>
						<MoreHorizontal className="icon" />
					</button>
					<button
						type="button"
						className="demo-icon-button"
						aria-label="Notifications"
						title="Notifications"
					>
						<Bell className="icon" />
					</button>
				</div>
				<div className="badge-row">
					<span className="demo-badge default">Default</span>
					<span className="demo-badge secondary">Secondary</span>
					<span className="demo-badge variant-outline">Outline</span>
					<span className="demo-badge destructive">Destructive</span>
					<span className="demo-badge success">Success</span>
				</div>
				<div className="feedback-grid">
					<div className="demo-alert info">
						<Info className="icon" />
						<div>
							<strong>System notice</strong>
							<span>Background sync is current.</span>
						</div>
					</div>
					<div className="demo-alert success">
						<ShieldCheck className="icon" />
						<div>
							<strong>Verified</strong>
							<span>Production checks completed.</span>
						</div>
					</div>
					<div className="demo-toast">
						<Bell className="icon" />
						<span>Notification toast</span>
						<button type="button" aria-label="Dismiss notification">
							<X className="icon" />
						</button>
					</div>
				</div>
				<div className="feedback-grid compact">
					<div className="progress-block">
						<div>
							<span>Usage</span>
							<strong>{progress}%</strong>
						</div>
						<div className="progress-track">
							<div
								className="progress-fill"
								style={{ width: `${progress}%` }}
							/>
						</div>
						<button
							type="button"
							className="demo-button secondary"
							onClick={() => setProgress((value) => (value + 10) % 110)}
						>
							Simulate Progress
						</button>
					</div>
					<div
						className="skeleton-stack"
						role="img"
						aria-label="Skeleton preview"
					>
						<span />
						<span />
						<span />
					</div>
					<div className="spinner-row">
						<LoaderCircle className="spinner-icon" />
						<span>Loading state</span>
					</div>
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="cards-heading">
				<h2 id="cards-heading">Cards & Content</h2>
				<div className="component-grid">
					<article className="demo-card">
						<header>
							<h3>Project Update</h3>
							<p>Latest milestones achieved this week.</p>
						</header>
						<p>
							The template keeps routing, querying, table primitives, optional
							auth, and a compact Hono API surface.
						</p>
						<footer>
							<button type="button" className="demo-button variant-outline">
								Cancel
							</button>
							<button type="button" className="demo-button primary">
								Deploy
							</button>
						</footer>
					</article>

					<article className="demo-card highlighted">
						<header className="card-header-row">
							<h3>Statistics</h3>
							<span className="demo-badge variant-outline">Live</span>
						</header>
						<div className="metric-row">
							<div>
								<span>Revenue</span>
								<strong>{new Intl.NumberFormat("en-US").format(42800)}</strong>
							</div>
							<div>
								<span>Updated</span>
								<strong>
									{new Intl.DateTimeFormat("en-US", {
										month: "short",
										day: "numeric",
									}).format(new Date("2026-06-13T00:00:00+09:00"))}
								</strong>
							</div>
						</div>
						<button
							type="button"
							className="demo-button secondary full"
							onClick={() => {
								setCopied(true);
								window.setTimeout(() => setCopied(false), 1200);
							}}
						>
							<Copy className="icon" />
							{copied ? "Copied" : "Copy Report"}
						</button>
					</article>

					<article className="demo-card profile-card">
						<header className="profile-header">
							<div className="avatar">TU</div>
							<div>
								<h3>Team Profile</h3>
								<p>@template-team - Verified</p>
							</div>
						</header>
						<ul className="demo-list">
							<li>
								<Mail className="icon" />
								<span>template@example.com</span>
							</li>
							<li>
								<Calendar className="icon" />
								<span>Joined Jun 2026</span>
							</li>
							<li>
								<Star className="icon" />
								<span>Design system maintainer</span>
							</li>
						</ul>
					</article>
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="forms-heading">
				<h2 id="forms-heading">Forms & Selection</h2>
				<div className="demo-card form-card">
					<div className="form-column">
						<label htmlFor="showcase-email">Email Address</label>
						<div className="input-group">
							<Mail className="icon" />
							<input
								id="showcase-email"
								placeholder="name@example.com"
								type="email"
							/>
						</div>

						<label htmlFor="showcase-framework">Framework</label>
						<select
							id="showcase-framework"
							className="demo-input"
							value={selectedFramework}
							onChange={(event) => setSelectedFramework(event.target.value)}
						>
							<option>React</option>
							<option>SvelteKit</option>
							<option>Astro</option>
							<option>Remix</option>
						</select>

						<label htmlFor="showcase-search">Searchable Select</label>
						<div className="input-group">
							<Search className="icon" />
							<input id="showcase-search" defaultValue={selectedFramework} />
							<ChevronDown className="icon" />
						</div>

						<label htmlFor="showcase-notes">Textarea</label>
						<textarea
							id="showcase-notes"
							className="demo-textarea"
							defaultValue="Reusable form controls with compact spacing."
						/>
					</div>
					<div className="switch-column">
						<label className="switch-row">
							<input
								type="checkbox"
								checked={acceptedTerms}
								onChange={(event) => setAcceptedTerms(event.target.checked)}
							/>
							<span>Checkbox</span>
						</label>
						<label className="switch-row">
							<input
								type="checkbox"
								checked={notificationsEnabled}
								onChange={(event) =>
									setNotificationsEnabled(event.target.checked)
								}
							/>
							<span>Switch</span>
						</label>
						<fieldset className="radio-group">
							<legend>Radio Group</legend>
							<label>
								<input
									type="radio"
									name="plan"
									value="starter"
									checked={selectedPlan === "starter"}
									onChange={(event) => setSelectedPlan(event.target.value)}
								/>
								<span>Starter</span>
							</label>
							<label>
								<input
									type="radio"
									name="plan"
									value="team"
									checked={selectedPlan === "team"}
									onChange={(event) => setSelectedPlan(event.target.value)}
								/>
								<span>Team</span>
							</label>
							<label>
								<input
									type="radio"
									name="plan"
									value="enterprise"
									checked={selectedPlan === "enterprise"}
									onChange={(event) => setSelectedPlan(event.target.value)}
								/>
								<span>Enterprise</span>
							</label>
						</fieldset>
						<fieldset className="otp-row">
							<legend className="sr-only">One-time passcode</legend>
							<input
								aria-label="Digit 1"
								defaultValue="2"
								inputMode="numeric"
							/>
							<input
								aria-label="Digit 2"
								defaultValue="4"
								inputMode="numeric"
							/>
							<input
								aria-label="Digit 3"
								defaultValue="8"
								inputMode="numeric"
							/>
							<input
								aria-label="Digit 4"
								defaultValue="6"
								inputMode="numeric"
							/>
						</fieldset>
						<div className="scale-input">
							<label htmlFor="showcase-scale">Scale Input</label>
							<input id="showcase-scale" type="range" min="0" max="100" />
						</div>
					</div>
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="nav-heading">
				<h2 id="nav-heading">Navigation & Disclosure</h2>
				<nav className="breadcrumb" aria-label="Breadcrumb">
					<a href="/">Home</a>
					<span>/</span>
					<a href="/showcase">Showcase</a>
					<span>/</span>
					<strong>Components</strong>
				</nav>
				<div className="nav-layout-grid">
					<div className="tabs-card">
						<div className="tabs-list" role="tablist" aria-label="Example tabs">
							<button
								type="button"
								role="tab"
								className={activeTab === "account" ? "active" : ""}
								aria-selected={activeTab === "account"}
								onClick={() => setActiveTab("account")}
							>
								Account
							</button>
							<button
								type="button"
								role="tab"
								className={activeTab === "password" ? "active" : ""}
								aria-selected={activeTab === "password"}
								onClick={() => setActiveTab("password")}
							>
								Password
							</button>
							<button
								type="button"
								role="tab"
								className={activeTab === "settings" ? "active" : ""}
								aria-selected={activeTab === "settings"}
								onClick={() => setActiveTab("settings")}
							>
								Settings
							</button>
						</div>
						<div className="tab-content">
							{activeTab === "account" ? (
								<>
									<h3>Account Information</h3>
									<input className="demo-input" defaultValue="Template User" />
									<input className="demo-input" defaultValue="@template-user" />
								</>
							) : null}
							{activeTab === "password" ? (
								<>
									<h3>Password Security</h3>
									<input className="demo-input" type="password" />
									<input className="demo-input" type="password" />
								</>
							) : null}
							{activeTab === "settings" ? (
								<>
									<h3>Global Settings</h3>
									<label className="switch-row split">
										<span>Public Profile</span>
										<input type="checkbox" />
									</label>
								</>
							) : null}
						</div>
					</div>

					<div className="disclosure-stack">
						{["tokens", "layout", "forms"].map((item) => (
							<div className="accordion-item" key={item}>
								<button
									type="button"
									aria-expanded={openAccordion === item}
									onClick={() =>
										setOpenAccordion(openAccordion === item ? "" : item)
									}
								>
									<span>{getAccordionLabel(item)}</span>
									<ChevronDown className="icon" />
								</button>
								{openAccordion === item ? (
									<p>{getAccordionContent(item)}</p>
								) : null}
							</div>
						))}
					</div>
				</div>
				<div className="toolbar-row">
					<div className="menu-wrap">
						<button
							type="button"
							className="demo-button variant-outline"
							aria-expanded={menuOpen}
							onClick={() => setMenuOpen((value) => !value)}
						>
							Menu
							<ChevronDown className="icon" />
						</button>
						{menuOpen ? (
							<div className="dropdown-panel">
								<button type="button">Edit</button>
								<button type="button">Duplicate</button>
								<button type="button">Archive</button>
							</div>
						) : null}
					</div>
					<fieldset className="view-switcher">
						<legend className="sr-only">View switcher</legend>
						<button
							type="button"
							className={activeView === "grid" ? "active" : ""}
							aria-pressed={activeView === "grid"}
							onClick={() => setActiveView("grid")}
						>
							<Grid2X2 className="icon" />
						</button>
						<button
							type="button"
							className={activeView === "list" ? "active" : ""}
							aria-pressed={activeView === "list"}
							onClick={() => setActiveView("list")}
						>
							<List className="icon" />
						</button>
					</fieldset>
					<nav className="pagination-row" aria-label="Pagination">
						{[1, 2, 3, 4].map((page) => (
							<button
								type="button"
								key={page}
								className={activePage === page ? "active" : ""}
								onClick={() => setActivePage(page)}
							>
								{page}
							</button>
						))}
					</nav>
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="overlay-heading">
				<h2 id="overlay-heading">Overlays & Panels</h2>
				<div className="overlay-grid">
					<div className="demo-card">
						<h3>Dialog</h3>
						<button
							type="button"
							className="demo-button primary"
							onClick={() => setDialogOpen(true)}
						>
							Open Dialog
						</button>
					</div>
					<div className="demo-card">
						<h3>Popover</h3>
						<div className="menu-wrap">
							<button
								type="button"
								className="demo-button variant-outline"
								aria-expanded={popoverOpen}
								onClick={() => setPopoverOpen((value) => !value)}
							>
								<Info className="icon" />
								Status
							</button>
							{popoverOpen ? (
								<div className="popover-panel">
									<strong>Healthy</strong>
									<span>All checks are passing.</span>
								</div>
							) : null}
						</div>
					</div>
					<div className="demo-card">
						<h3>Drawer</h3>
						<button
							type="button"
							className="demo-button secondary"
							onClick={() => setDrawerOpen(true)}
						>
							<PanelRight className="icon" />
							Open Panel
						</button>
					</div>
					<div className="demo-card">
						<h3>Tooltip</h3>
						<div className="tooltip-anchor">
							<button type="button" className="demo-icon-button">
								<CreditCard className="icon" />
							</button>
							<span className="tooltip-bubble">Billing settings</span>
						</div>
					</div>
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="table-heading">
				<h2 id="table-heading">Data Display</h2>
				<div className="data-layout-grid">
					<div className="table-demo">
						<div className="table-toolbar">
							<div>
								<strong>Component Inventory</strong>
								<span>
									{table.getPrePaginationRowModel().rows.length} components
								</span>
							</div>
							<label htmlFor="showcase-page-size">
								Rows
								<select
									id="showcase-page-size"
									value={search.pageSize}
									onChange={(event) => {
										table.setPageSize(Number(event.target.value));
										void updateTableSearch({
											page: 1,
											pageSize: Number(event.target.value),
										});
									}}
								>
									{showcaseTablePageSizes.map((pageSize) => (
										<option key={pageSize} value={pageSize}>
											{pageSize}
										</option>
									))}
								</select>
							</label>
						</div>
						<div className="table-panel">
							<table>
								<thead>
									{table.getHeaderGroups().map((headerGroup) => (
										<tr key={headerGroup.id}>
											{headerGroup.headers.map((header) => (
												<th key={header.id}>
													{header.isPlaceholder ? null : (
														<button
															type="button"
															className="table-sort-button"
															onClick={header.column.getToggleSortingHandler()}
															aria-label={`Sort by ${String(
																header.column.columnDef.header,
															)}`}
														>
															<span>
																{flexRender(
																	header.column.columnDef.header,
																	header.getContext(),
																)}
															</span>
															<span
																className="table-sort-icon"
																aria-hidden="true"
															>
																{getSortIndicator(header.column.getIsSorted())}
															</span>
														</button>
													)}
												</th>
											))}
										</tr>
									))}
								</thead>
								<tbody>
									{table.getRowModel().rows.map((row) => (
										<tr key={row.id}>
											{row.getVisibleCells().map((cell) => (
												<td key={cell.id}>
													{flexRender(
														cell.column.columnDef.cell,
														cell.getContext(),
													)}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="table-pagination-bar">
							<div className="table-page-summary">
								Page {table.getState().pagination.pageIndex + 1} of{" "}
								{table.getPageCount()}
							</div>
							<nav className="table-pagination" aria-label="Table pagination">
								<button
									type="button"
									onClick={() => {
										table.previousPage();
										void updateTableSearch({
											page: search.page - 1,
										});
									}}
									disabled={!table.getCanPreviousPage()}
								>
									Previous
								</button>
								{visiblePageNumbers.map((pageNumber) => (
									<button
										type="button"
										key={pageNumber}
										className={search.page === pageNumber ? "active" : ""}
										aria-current={
											search.page === pageNumber ? "page" : undefined
										}
										onClick={() => {
											table.setPageIndex(pageNumber - 1);
											void updateTableSearch({
												page: pageNumber,
											});
										}}
									>
										{pageNumber}
									</button>
								))}
								<button
									type="button"
									onClick={() => {
										table.nextPage();
										void updateTableSearch({
											page: search.page + 1,
										});
									}}
									disabled={!table.getCanNextPage()}
								>
									Next
								</button>
							</nav>
						</div>
					</div>
					<div className="side-data">
						<div className="mini-table">
							<div>
								<span>Health</span>
								<strong>99%</strong>
							</div>
							<div>
								<span>Latency</span>
								<strong>42ms</strong>
							</div>
							<div>
								<span>Errors</span>
								<strong>0</strong>
							</div>
						</div>
						<ul className="file-tree">
							<li>
								<Folder className="icon" />
								<span>src</span>
							</li>
							<li>
								<FileText className="icon" />
								<span>routes/showcase-route.tsx</span>
							</li>
							<li>
								<FileText className="icon" />
								<span>views/showcase-view.tsx</span>
							</li>
						</ul>
					</div>
				</div>
			</section>

			{dialogOpen ? (
				<div className="modal-backdrop" role="presentation">
					<div className="modal-panel" role="dialog" aria-modal="true">
						<header>
							<h3>Confirm deployment</h3>
							<button
								type="button"
								className="demo-icon-button"
								aria-label="Close dialog"
								onClick={() => setDialogOpen(false)}
							>
								<X className="icon" />
							</button>
						</header>
						<p>Deploy the current template snapshot.</p>
						<footer>
							<button
								type="button"
								className="demo-button variant-outline"
								onClick={() => setDialogOpen(false)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="demo-button primary"
								onClick={() => setDialogOpen(false)}
							>
								Deploy
							</button>
						</footer>
					</div>
				</div>
			) : null}

			{drawerOpen ? (
				<div className="drawer-backdrop" role="presentation">
					<aside className="drawer-panel" aria-label="Settings panel">
						<header>
							<h3>Panel</h3>
							<button
								type="button"
								className="demo-icon-button"
								aria-label="Close panel"
								onClick={() => setDrawerOpen(false)}
							>
								<X className="icon" />
							</button>
						</header>
						<div className="switch-column">
							<label className="switch-row split">
								<span>Audit log</span>
								<input type="checkbox" defaultChecked />
							</label>
							<label className="switch-row split">
								<span>Compact mode</span>
								<input type="checkbox" />
							</label>
						</div>
					</aside>
				</div>
			) : null}
		</main>
	);
}

function getComponentCategory(component: string) {
	if (
		[
			"Button",
			"IconButton",
			"Badge",
			"Alert",
			"NotificationToast",
			"Progress",
			"Skeleton",
			"Spinner",
		].includes(component)
	) {
		return "Actions & Feedback";
	}
	if (
		[
			"Input",
			"InputGroup",
			"InputOtp",
			"Textarea",
			"Select",
			"Combobox",
			"Checkbox",
			"RadioGroup",
			"Switch",
		].includes(component)
	) {
		return "Forms";
	}
	if (
		[
			"Tabs",
			"Breadcrumb",
			"Accordion",
			"DropdownMenu",
			"Pagination",
			"ViewSwitcher",
		].includes(component)
	) {
		return "Navigation";
	}
	if (["Dialog", "Drawer", "Popover", "Tooltip"].includes(component)) {
		return "Overlays";
	}
	if (["Table", "MiniTable", "List", "FileTree"].includes(component)) {
		return "Data Display";
	}
	return "Content";
}

function getComponentStatus(component: string) {
	const category = getComponentCategory(component);
	if (category === "Navigation" || category === "Overlays") {
		return "Interactive";
	}
	if (category === "Actions & Feedback" || category === "Forms") {
		return "Ready";
	}
	return "Documented";
}

function getSortIndicator(sortState: false | "asc" | "desc") {
	if (sortState === "asc") {
		return <ArrowUp className="icon" />;
	}
	if (sortState === "desc") {
		return <ArrowDown className="icon" />;
	}
	return <ArrowUpDown className="icon" />;
}

function getVisiblePageNumbers(pageCount: number, currentPage: number) {
	const safePageCount = Math.max(pageCount, 1);
	const safeCurrentPage = Math.min(Math.max(currentPage, 1), safePageCount);
	const startPage = Math.max(1, safeCurrentPage - 1);
	const endPage = Math.min(safePageCount, startPage + 2);
	const adjustedStartPage = Math.max(1, endPage - 2);

	return Array.from(
		{ length: endPage - adjustedStartPage + 1 },
		(_, index) => adjustedStartPage + index,
	);
}

function getAccordionLabel(item: string) {
	if (item === "tokens") {
		return "Design Tokens";
	}
	if (item === "layout") {
		return "Layout";
	}
	return "Forms";
}

function getAccordionContent(item: string) {
	if (item === "tokens") {
		return "Color, radius, spacing, and typography primitives.";
	}
	if (item === "layout") {
		return "Cards, panels, sections, and dense application surfaces.";
	}
	return "Fields, selection controls, and validation states.";
}
