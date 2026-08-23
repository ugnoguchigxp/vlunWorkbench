import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
	type AuthUser,
	fetchMe,
	fetchSourceCategories,
	fetchSourceHealth,
	fetchSystemContext,
	login,
	logout,
	type SourceHealth,
	UNAUTHORIZED_EVENT_NAME,
} from "./api";
import { AppHeader } from "./app-header";
import { LoginDomainSection } from "./domains/auth/login-domain";
import { KnowledgeNavigationProvider } from "./domains/knowledge/knowledge-navigation";

const KnowledgeDomainSection = lazy(() =>
	import("./domains/knowledge/knowledge-domain").then((module) => ({
		default: module.KnowledgeDomainSection,
	})),
);
const ProjectsDomainSection = lazy(() =>
	import("./domains/projects/projects-domain").then((module) => ({
		default: module.ProjectsDomainSection,
	})),
);
const ScansDomainSection = lazy(() =>
	import("./domains/scans/scans-domain").then((module) => ({
		default: module.ScansDomainSection,
	})),
);

const ChatDomainSection = lazy(() =>
	import("./domains/chat/chat-domain").then((module) => ({
		default: module.ChatDomainSection,
	})),
);
const SearchDomainSection = lazy(() =>
	import("./domains/search/search-domain").then((module) => ({
		default: module.SearchDomainSection,
	})),
);
const SettingsPanel = lazy(() =>
	import("./settings-panel").then((module) => ({
		default: module.SettingsPanel,
	})),
);
const AdminUserManagementPanel = lazy(() =>
	import("./admin-user-management").then((module) => ({
		default: module.AdminUserManagementPanel,
	})),
);

export type AppViewId =
	| "knowledge"
	| "chat"
	| "search"
	| "settings"
	| "admin"
	| "projects"
	| "scans";

type AppProps = {
	view: AppViewId;
};

type AppHealth = {
	status: string;
	service: string;
};

const isUnauthorizedError = (error: unknown): boolean =>
	error instanceof Error &&
	(error.message === "Unauthorized" || error.message.includes("401"));

export function App({ view }: AppProps) {
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [authUser, setAuthUser] = useState<AuthUser | null>(null);
	const [authLoading, setAuthLoading] = useState(true);

	const [sourceHealth, setSourceHealth] = useState<SourceHealth | null>(null);
	const [appHealth, setAppHealth] = useState<AppHealth | null>(null);

	const [availableCategories, setAvailableCategories] = useState<string[]>([
		"tech",
	]);
	const [systemContextText, setSystemContextText] = useState("");
	const [systemContextUpdatedAt, setSystemContextUpdatedAt] = useState<
		string | null
	>(null);
	const [systemContextSaving, setSystemContextSaving] = useState(false);
	const [settingsDirty, setSettingsDirty] = useState(false);

	const loadHealth = async () => {
		const [source, app] = await Promise.all([
			fetchSourceHealth(),
			fetch("/api/health").then(async (res) => (await res.json()) as AppHealth),
		]);
		setSourceHealth(source);
		setAppHealth(app);
	};

	const loadCategories = async () => {
		const categories = await fetchSourceCategories();
		const normalized = categories.length > 0 ? categories : ["tech"];
		setAvailableCategories(normalized);
	};

	const loadSystemContext = async () => {
		const settings = await fetchSystemContext();
		setSystemContextText(settings.systemContext);
		setSystemContextUpdatedAt(settings.updatedAt);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: initial load
	useEffect(() => {
		void (async () => {
			try {
				setErrorText(null);
				const me = await fetchMe();
				setAuthUser(me);
				await Promise.all([
					loadHealth(),
					loadCategories(),
					loadSystemContext(),
				]);
			} catch (error) {
				if (!isUnauthorizedError(error)) {
					setErrorText(
						error instanceof Error ? error.message : "Failed to load app.",
					);
				}
			} finally {
				setAuthLoading(false);
			}
		})();
	}, []);

	useEffect(() => {
		if (view === "admin" && authUser?.role !== "admin") {
			void navigate({ to: "/settings", replace: true });
		}
	}, [authUser?.role, navigate, view]);

	useEffect(() => {
		const onUnauthorized = () => {
			setAuthUser(null);
			setSystemContextText("");
			setSystemContextUpdatedAt(null);
			setErrorText("Session expired. Please login again.");
		};
		window.addEventListener(UNAUTHORIZED_EVENT_NAME, onUnauthorized);
		return () => {
			window.removeEventListener(UNAUTHORIZED_EVENT_NAME, onUnauthorized);
		};
	}, []);

	const withBusy = useCallback(
		async (task: () => Promise<void>): Promise<boolean> => {
			setBusy(true);
			setErrorText(null);
			try {
				await task();
				return true;
			} catch (error) {
				if (isUnauthorizedError(error)) {
					setAuthUser(null);
					setErrorText("Session expired. Please login again.");
				} else {
					setErrorText(
						error instanceof Error ? error.message : "Operation failed.",
					);
				}
				return false;
			} finally {
				setBusy(false);
			}
		},
		[],
	);

	const handleLogin = async ({
		email,
		password,
	}: {
		email: string;
		password: string;
	}): Promise<boolean> => {
		if (!email || !password) return false;
		return await withBusy(async () => {
			const response = await login({ email, password });
			setAuthUser(response.user);
			await Promise.all([loadHealth(), loadCategories(), loadSystemContext()]);
		});
	};

	const handleLogout = async () => {
		if (
			settingsDirty &&
			!window.confirm("未保存の変更があります。ログアウトしますか？")
		)
			return;
		await withBusy(async () => {
			await logout();
			setAuthUser(null);
			setSystemContextText("");
			setSystemContextUpdatedAt(null);
			setSettingsDirty(false);
			await navigate({ to: "/chat" });
		});
	};

	return (
		<div className="app-root">
			<AppHeader
				active={view}
				authUser={authUser}
				busy={busy}
				onLogout={() => void handleLogout()}
			/>

			{errorText ? <div className="status error">{errorText}</div> : null}

			{authLoading ? (
				<main className="layout columns-1">
					<section className="panel">
						<div className="tree-info">Loading session...</div>
					</section>
				</main>
			) : null}

			<LoginDomainSection
				active={!authLoading && !authUser}
				busy={busy}
				onLogin={handleLogin}
			/>

			{authUser ? (
				<KnowledgeNavigationProvider
					onOpenKnowledge={() => void navigate({ to: "/knowledge" })}
				>
					<Suspense
						fallback={
							<main className="layout columns-1">
								<section className="panel">Loading view...</section>
							</main>
						}
					>
						{view === "knowledge" ? (
							<KnowledgeDomainSection
								active
								isAdmin={authUser.role === "admin"}
							/>
						) : null}
						{view === "chat" ? (
							<ChatDomainSection
								active
								busy={busy}
								runWithBusy={withBusy}
								availableCategories={availableCategories}
								setErrorText={setErrorText}
							/>
						) : null}
						{view === "search" ? (
							<SearchDomainSection
								active
								busy={busy}
								runWithBusy={withBusy}
								availableCategories={availableCategories}
							/>
						) : null}
						{view === "projects" ? (
							<ProjectsDomainSection
								active
								busy={busy}
								runWithBusy={withBusy}
								setErrorText={setErrorText}
							/>
						) : null}
						{view === "scans" ? (
							<ScansDomainSection
								active
								busy={busy}
								runWithBusy={withBusy}
								setErrorText={setErrorText}
							/>
						) : null}
						{view === "settings" ? (
							<SettingsPanel
								isAdmin={authUser.role === "admin"}
								appHealth={appHealth}
								sourceHealth={sourceHealth}
								systemContextText={systemContextText}
								systemContextUpdatedAt={systemContextUpdatedAt}
								systemContextSaving={systemContextSaving}
								onSystemContextTextChange={setSystemContextText}
								onSystemContextSaved={(systemContext, updatedAt) => {
									setSystemContextText(systemContext);
									setSystemContextUpdatedAt(updatedAt);
								}}
								onSystemContextSavingChange={setSystemContextSaving}
								onDirtyChange={setSettingsDirty}
							/>
						) : null}
						{authUser.role === "admin" && view === "admin" ? (
							<AdminUserManagementPanel
								busy={busy}
								runWithBusy={withBusy}
								setErrorText={setErrorText}
							/>
						) : null}
					</Suspense>
				</KnowledgeNavigationProvider>
			) : null}
		</div>
	);
}
