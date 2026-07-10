import { Link } from "@tanstack/react-router";
import {
	BookOpen,
	Bot,
	Database,
	FolderKanban,
	Grid2X2,
	LogOut,
	Search,
	Settings,
	Shield,
} from "lucide-react";
import type { AuthUser } from "./api";
import { defaultShowcaseTableSearch } from "./showcase-table-search";

export type HeaderActiveItem =
	| "knowledge"
	| "chat"
	| "search"
	| "settings"
	| "admin"
	| "showcase"
	| "projects"
	| "scans";

type AppHeaderProps = {
	active: HeaderActiveItem;
	authUser?: AuthUser | null;
	busy?: boolean;
	onLogout?: () => void;
};

const menuClass = (active: boolean) =>
	active ? "menu-link active" : "menu-link";

export function AppHeader({
	active,
	authUser,
	busy = false,
	onLogout,
}: AppHeaderProps) {
	return (
		<header className="topbar">
			<Link to="/chat" className="brand">
				<Database className="icon" />
				<span>vulnWorkbench</span>
			</Link>
			<div className="topbar-actions">
				<nav className="menu-nav" aria-label="Primary">
					<Link to="/knowledge" className={menuClass(active === "knowledge")}>
						<BookOpen className="icon" />
						Knowledge
					</Link>
					<Link to="/chat" className={menuClass(active === "chat")}>
						<Bot className="icon" />
						Chat
					</Link>
					<Link to="/search" className={menuClass(active === "search")}>
						<Search className="icon" />
						Search
					</Link>
					<Link to="/projects" className={menuClass(active === "projects")}>
						<FolderKanban className="icon" />
						Projects
					</Link>
					<Link
						to="/scans"
						search={{ projectId: undefined, scanRunId: undefined }}
						className={menuClass(active === "scans")}
					>
						<Shield className="icon" />
						Scans
					</Link>
					<Link to="/settings" className={menuClass(active === "settings")}>
						<Settings className="icon" />
						Settings
					</Link>
					<Link
						to="/showcase"
						search={defaultShowcaseTableSearch}
						className={menuClass(active === "showcase")}
					>
						<Grid2X2 className="icon" />
						Showcase
					</Link>
				</nav>
				{authUser ? (
					<>
						<div className="auth-chip">
							<Shield className="icon" />
							<span>
								{authUser.displayName} ({authUser.role})
							</span>
						</div>
						{onLogout ? (
							<button
								type="button"
								className="icon-button"
								onClick={onLogout}
								disabled={busy}
								aria-label="Logout"
								title="Logout"
							>
								<LogOut className="icon" />
							</button>
						) : null}
					</>
				) : null}
			</div>
		</header>
	);
}
