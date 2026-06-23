import { Activity, BookOpen, Brain, Database, GitBranch } from "lucide-react";
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
	updateSystemContext,
} from "./api";
import { AdminUserManagementPanel } from "./admin-user-management";
import { AppHeader } from "./app-header";
import { LoginDomainSection } from "./domains/auth/login-domain";
import { ChatDomainSection } from "./domains/chat/chat-domain";
import {
	KnowledgeDomainSection,
	KnowledgeNavigationProvider,
} from "./domains/knowledge/knowledge-domain";
import { SearchDomainSection } from "./domains/search/search-domain";
import { Button, TextArea } from "./ui";

export type AppViewId = "knowledge" | "chat" | "search" | "settings" | "admin";

type AppProps = {
	view: AppViewId;
};

type AppHealth = {
	status: string;
	service: string;
};

const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
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

	const handleSaveSystemContext = async () => {
		setSystemContextSaving(true);
		setErrorText(null);
		try {
			const updated = await updateSystemContext(systemContextText);
			setSystemContextText(updated.systemContext);
			setSystemContextUpdatedAt(updated.updatedAt);
		} catch (error) {
			setErrorText(
				error instanceof Error ? error.message : "Failed to save settings.",
			);
		} finally {
			setSystemContextSaving(false);
		}
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
					{view === "settings" ? (
						<main className="layout columns-2">
							<section className="panel">
								<div className="panel-header">
									<h2>API Health</h2>
								</div>
								<div className="meta-list">
									<div>
										<Activity />
										<span>{appHealth?.status ?? "-"}</span>
									</div>
									<div>
										<Database />
										<span>{appHealth?.service ?? "-"}</span>
									</div>
								</div>
							</section>
							<section className="panel">
								<div className="panel-header">
									<h2>Knowledge Git</h2>
								</div>
								<div className="meta-list">
									<div>
										<GitBranch />
										<span>{sourceHealth?.git?.branch ?? "-"}</span>
									</div>
									<div>
										<BookOpen />
										<span>{sourceHealth?.git?.commit ?? "-"}</span>
									</div>
								</div>
							</section>
							<section className="panel">
								<div className="panel-header">
									<h2>System Context</h2>
								</div>
								<div className="form-stack">
									<label htmlFor="system-context-input">
										Agentic Search Prompt
									</label>
									<TextArea
										id="system-context-input"
										value={systemContextText}
										onChange={(event) =>
											setSystemContextText(event.target.value)
										}
										placeholder="System context for this user..."
									/>
									<div className="actions">
										<Button
											type="button"
											variant="primary"
											className="search-btn"
											onClick={() => void handleSaveSystemContext()}
											disabled={systemContextSaving}
										>
											<Brain className="icon" />
											<span>Save</span>
										</Button>
										<small>
											updated:{" "}
											{formatDateTime(systemContextUpdatedAt ?? undefined)}
										</small>
									</div>
								</div>
							</section>
						</main>
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
