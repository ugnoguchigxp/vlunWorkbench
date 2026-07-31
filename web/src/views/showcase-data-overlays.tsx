import { flexRender, type Table } from "@tanstack/react-table";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	CreditCard,
	FileText,
	Folder,
	Info,
	PanelRight,
	X,
} from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import {
	type ShowcaseTableSearch,
	showcaseTablePageSizes,
} from "../showcase-table-search";
import type { ShowcaseRow } from "./showcase-model";

type ShowcaseDataOverlaysProps = {
	dialogOpen: boolean;
	setDialogOpen: Dispatch<SetStateAction<boolean>>;
	popoverOpen: boolean;
	setPopoverOpen: Dispatch<SetStateAction<boolean>>;
	drawerOpen: boolean;
	setDrawerOpen: Dispatch<SetStateAction<boolean>>;
	table: Table<ShowcaseRow>;
	search: ShowcaseTableSearch;
	updateTableSearch: (
		nextSearch: Partial<ShowcaseTableSearch>,
	) => Promise<void>;
};

export function ShowcaseDataOverlays(props: ShowcaseDataOverlaysProps) {
	const {
		dialogOpen,
		setDialogOpen,
		popoverOpen,
		setPopoverOpen,
		drawerOpen,
		setDrawerOpen,
		table,
		search,
		updateTableSearch,
	} = props;
	const visiblePageNumbers = getVisiblePageNumbers(
		table.getPageCount(),
		search.page,
	);

	return (
		<>
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
		</>
	);
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
