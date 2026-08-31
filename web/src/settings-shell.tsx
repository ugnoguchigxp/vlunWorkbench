import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import {
	searchSettingsNavigation,
	visibleSettingsNavigation,
} from "./settings-navigation-model";
import {
	buildSettingsSectionSearch,
	type SettingsSectionId,
} from "./settings-route-search";

type SettingsShellProps = {
	activeSection: SettingsSectionId;
	isAdmin: boolean;
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	onSearchDismiss: () => void;
	onSelectSection: (section: SettingsSectionId) => void;
	children: ReactNode;
};

export function SettingsShell({
	activeSection,
	isAdmin,
	searchQuery,
	onSearchQueryChange,
	onSearchDismiss,
	onSelectSection,
	children,
}: SettingsShellProps) {
	const items = visibleSettingsNavigation(isAdmin);
	const results = searchSettingsNavigation(items, searchQuery);
	return (
		<main className="layout settings-layout settings-redesign-layout">
			<header className="settings-page-header">
				<div>
					<h1>設定</h1>
					<p>アプリ、AI、スキャン実行環境を管理します。</p>
				</div>
				<div className="settings-search">
					<label htmlFor="settings-category-search">設定を検索</label>
					<div className="settings-search-input">
						<Search className="icon" aria-hidden="true" />
						<input
							id="settings-category-search"
							value={searchQuery}
							onChange={(event) => onSearchQueryChange(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") onSearchDismiss();
							}}
							placeholder="例: Codex、Docker、コンテキスト"
						/>
					</div>
					{searchQuery ? (
						<ul className="settings-search-results">
							{results.length ? (
								results.map((item) => (
									<li key={item.id}>
										<Link
											to="/settings"
											search={buildSettingsSectionSearch(item.id)}
											onClick={onSearchDismiss}
										>
											{item.label}
										</Link>
									</li>
								))
							) : (
								<li>該当する設定はありません</li>
							)}
						</ul>
					) : null}
				</div>
			</header>
			<div className="settings-shell-grid">
				<nav className="settings-category-nav" aria-label="設定カテゴリ">
					{items.map((item) => {
						const Icon = item.icon;
						return (
							<Link
								key={item.id}
								to="/settings"
								search={buildSettingsSectionSearch(item.id)}
								className={activeSection === item.id ? "active" : ""}
							>
								<Icon className="icon" aria-hidden="true" />
								<span>{item.label}</span>
								{item.showAdminBadge ? <small>管理者</small> : null}
							</Link>
						);
					})}
				</nav>
				<div className="settings-mobile-category">
					<label htmlFor="settings-section-select">設定カテゴリ</label>
					<select
						id="settings-section-select"
						value={activeSection}
						onChange={(event) =>
							onSelectSection(event.target.value as SettingsSectionId)
						}
					>
						{items.map((item) => (
							<option key={item.id} value={item.id}>
								{item.label}
							</option>
						))}
					</select>
				</div>
				<div className="settings-content">{children}</div>
			</div>
		</main>
	);
}
