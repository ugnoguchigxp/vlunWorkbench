import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	type AuthUser,
	type SourceHealth,
	fetchMe,
	fetchSourceCategories,
	fetchSourceHealth,
	fetchSystemContext,
	login,
	logout,
	UNAUTHORIZED_EVENT_NAME,
} from "./api";
import { AdminUserManagementPanel } from "./admin-user-management";
import { AppHeader } from "./app-header";
import { LoginDomainSection } from "./domains/auth/login-domain";
import { ChatDomainSection } from "./domains/chat/chat-domain";
import {
	KnowledgeDomainSection,
	KnowledgeNavigationProvider,
} from "./domains/knowledge/knowledge-domain";
import { ProjectsDomainSection } from "./domains/projects/projects-domain";
import { SearchDomainSection } from "./domains/search/search-domain";
import { ScansDomainSection } from "./domains/scans/scans-domain";
import { SettingsPanel } from "./settings-panel";

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

	const withBusy = async (task: () => Promise<void>): Promise<boolean> => {
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
	};

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
		await withBusy(async () => {
			await logout();
			setAuthUser(null);
			setSystemContextText("");
			setSystemContextUpdatedAt(null);
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
					<KnowledgeDomainSection active={view === "knowledge"} />
					<ChatDomainSection
						active={view === "chat"}
						busy={busy}
						runWithBusy={withBusy}
						availableCategories={availableCategories}
						setErrorText={setErrorText}
					/>
					<SearchDomainSection
						active={view === "search"}
						busy={busy}
						runWithBusy={withBusy}
						availableCategories={availableCategories}
					/>
					<ProjectsDomainSection
						active={view === "projects"}
						busy={busy}
						runWithBusy={withBusy}
						setErrorText={setErrorText}
					/>
					<ScansDomainSection
						active={view === "scans"}
						busy={busy}
						runWithBusy={withBusy}
						setErrorText={setErrorText}
					/>
					{view === "settings" ? (
						<SettingsPanel
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
							setErrorText={setErrorText}
						/>
					) : null}
					{authUser.role === "admin" && view === "admin" ? (
						<AdminUserManagementPanel
							busy={busy}
							runWithBusy={withBusy}
							setErrorText={setErrorText}
						/>
					) : null}
				</KnowledgeNavigationProvider>
			) : null}
		</div>
	);
}
