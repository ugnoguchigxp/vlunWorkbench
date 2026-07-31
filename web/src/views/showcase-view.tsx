import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	type ColumnDef,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import { Grid2X2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useShowcaseSettings } from "../showcase-settings-context";
import {
	isShowcaseSortField,
	type ShowcaseTableSearch,
} from "../showcase-table-search";
import { ShowcaseAppearanceContent } from "./showcase-appearance-content";
import { ShowcaseDataOverlays } from "./showcase-data-overlays";
import { ShowcaseFormsNavigation } from "./showcase-forms-navigation";
import {
	getComponentCategory,
	getComponentStatus,
	type ShowcaseRow,
	visibleComponents,
} from "./showcase-model";

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

			<ShowcaseAppearanceContent
				settings={settings}
				setTheme={setTheme}
				setDensity={setDensity}
				setRadius={setRadius}
				setFontSize={setFontSize}
				resetSettings={resetSettings}
				progress={progress}
				setProgress={setProgress}
				copied={copied}
				setCopied={setCopied}
			/>
			<ShowcaseFormsNavigation
				selectedFramework={selectedFramework}
				setSelectedFramework={setSelectedFramework}
				notificationsEnabled={notificationsEnabled}
				setNotificationsEnabled={setNotificationsEnabled}
				acceptedTerms={acceptedTerms}
				setAcceptedTerms={setAcceptedTerms}
				selectedPlan={selectedPlan}
				setSelectedPlan={setSelectedPlan}
				activeTab={activeTab}
				setActiveTab={setActiveTab}
				openAccordion={openAccordion}
				setOpenAccordion={setOpenAccordion}
				menuOpen={menuOpen}
				setMenuOpen={setMenuOpen}
				activePage={activePage}
				setActivePage={setActivePage}
				activeView={activeView}
				setActiveView={setActiveView}
			/>
			<ShowcaseDataOverlays
				dialogOpen={dialogOpen}
				setDialogOpen={setDialogOpen}
				popoverOpen={popoverOpen}
				setPopoverOpen={setPopoverOpen}
				drawerOpen={drawerOpen}
				setDrawerOpen={setDrawerOpen}
				table={table}
				search={search}
				updateTableSearch={updateTableSearch}
			/>
		</main>
	);
}
