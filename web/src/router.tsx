import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
} from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { type AuthUser, fetchMe, logout, UNAUTHORIZED_EVENT_NAME } from "./api";
import { App, type AppViewId } from "./App";
import { AppHeader } from "./app-header";
import { DesignSystemProvider } from "./showcase-settings-context";
import { parseShowcaseTableSearch } from "./showcase-table-search";

const ShowcaseView = lazy(() =>
	import("./views/showcase-view").then((module) => ({
		default: module.ShowcaseView,
	})),
);

const rootRoute = createRootRoute({
	component: () => (
		<DesignSystemProvider>
			<Outlet />
		</DesignSystemProvider>
	),
});

const renderAppView = (view: AppViewId) => () => <App view={view} />;

const homeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: renderAppView("chat"),
});

const chatRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/chat",
	component: renderAppView("chat"),
});

const knowledgeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/knowledge",
	component: renderAppView("knowledge"),
});

const searchRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/search",
	component: renderAppView("search"),
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: renderAppView("settings"),
});

const scansRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/scans",
	validateSearch: (search: Record<string, unknown>) => ({
		projectId:
			typeof search.projectId === "string" ? search.projectId : undefined,
		scanRunId:
			typeof search.scanRunId === "string" ? search.scanRunId : undefined,
	}),
	component: renderAppView("scans"),
});

const projectsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/projects",
	component: renderAppView("projects"),
});

const projectDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/projects/$projectId",
	component: renderAppView("projects"),
});

const projectIntelligenceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/projects/$projectId/intelligence",
	validateSearch: (search: Record<string, unknown>) => ({
		scanRunId:
			typeof search.scanRunId === "string" ? search.scanRunId : undefined,
	}),
	component: renderAppView("projects"),
});

const adminRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/admin",
	component: renderAppView("admin"),
});

const isUnauthorizedError = (error: unknown): boolean =>
	error instanceof Error && /unauthorized/i.test(error.message);

function ShowcasePage() {
	const [authUser, setAuthUser] = useState<AuthUser | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		void fetchMe()
			.then((user) => {
				if (active) setAuthUser(user);
			})
			.catch((error) => {
				if (!isUnauthorizedError(error)) {
					console.error(error);
				}
				if (active) setAuthUser(null);
			});
		const handleUnauthorized = () => setAuthUser(null);
		window.addEventListener(UNAUTHORIZED_EVENT_NAME, handleUnauthorized);
		return () => {
			active = false;
			window.removeEventListener(UNAUTHORIZED_EVENT_NAME, handleUnauthorized);
		};
	}, []);

	const handleLogout = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		try {
			await logout();
			setAuthUser(null);
		} catch (error) {
			console.error(error);
		} finally {
			setBusy(false);
		}
	}, [busy]);

	return (
		<div className="app-root">
			<AppHeader
				active="showcase"
				authUser={authUser}
				busy={busy}
				onLogout={handleLogout}
			/>
			<Suspense
				fallback={
					<main className="layout columns-1">
						<section className="panel">Loading showcase...</section>
					</main>
				}
			>
				<ShowcaseView />
			</Suspense>
		</div>
	);
}

const showcaseRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/showcase",
	validateSearch: parseShowcaseTableSearch,
	component: ShowcasePage,
});

const routeTree = rootRoute.addChildren([
	homeRoute,
	chatRoute,
	knowledgeRoute,
	searchRoute,
	projectsRoute,
	projectDetailRoute,
	projectIntelligenceRoute,
	scansRoute,
	settingsRoute,
	adminRoute,
	showcaseRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
