import type { LucideIcon } from "lucide-react";
import {
	BrainCircuit,
	GitFork,
	House,
	MessageSquareText,
	Play,
	ShieldCheck,
	SlidersHorizontal,
} from "lucide-react";
import type { SettingsSectionId } from "./settings-route-search";

export type SettingsNavigationItem = {
	id: SettingsSectionId;
	label: string;
	description: string;
	keywords: string[];
	adminOnly: boolean;
	showAdminBadge: boolean;
	icon: LucideIcon;
};

export const settingsNavigation: SettingsNavigationItem[] = [
	{
		id: "overview",
		label: "概要",
		description: "アプリと設定の状態を確認します",
		keywords: ["状態", "サービス", "Git", "更新"],
		adminOnly: false,
		showAdminBadge: false,
		icon: House,
	},
	{
		id: "ai-models",
		label: "AI・モデル",
		description: "診断・レビューに使用するプロバイダーとモデルを管理します",
		keywords: ["AI", "LLM", "Codex", "OpenAI", "モデル", "APIキー", "接続"],
		adminOnly: true,
		showAdminBadge: false,
		icon: BrainCircuit,
	},
	{
		id: "task-routing",
		label: "タスクルーティング",
		description: "タスクごとのモデルとフォールバックを設定します",
		keywords: ["タスク", "ルーティング", "primary", "fallback", "thinking"],
		adminOnly: true,
		showAdminBadge: false,
		icon: GitFork,
	},
	{
		id: "scan-execution",
		label: "スキャン実行",
		description: "スキャナーの実行方式とDockerリソースを設定します",
		keywords: ["スキャン", "実行", "host", "Docker", "CPU", "メモリ", "PID"],
		adminOnly: true,
		showAdminBadge: true,
		icon: Play,
	},
	{
		id: "system-context",
		label: "システムコンテキスト",
		description: "エージェント検索で使用するコンテキストを編集します",
		keywords: ["システム", "コンテキスト", "Agentic Search", "prompt"],
		adminOnly: false,
		showAdminBadge: false,
		icon: MessageSquareText,
	},
	{
		id: "security",
		label: "セキュリティ",
		description: "隔離実行環境とDAST暗号鍵を管理します",
		keywords: ["セキュリティ", "isolation", "image", "hash", "DAST", "暗号鍵"],
		adminOnly: true,
		showAdminBadge: true,
		icon: ShieldCheck,
	},
	{
		id: "advanced",
		label: "詳細設定",
		description: "処理上限、タイムアウト、任意イメージを設定します",
		keywords: ["詳細", "limit", "queue", "timeout", "scanner", "database"],
		adminOnly: true,
		showAdminBadge: true,
		icon: SlidersHorizontal,
	},
];

export const visibleSettingsNavigation = (
	isAdmin: boolean,
): SettingsNavigationItem[] =>
	settingsNavigation.filter((item) => isAdmin || !item.adminOnly);

export const searchSettingsNavigation = (
	items: SettingsNavigationItem[],
	query: string,
): SettingsNavigationItem[] => {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) return [];
	return items.filter((item) =>
		[item.label, item.description, ...item.keywords]
			.join(" ")
			.toLocaleLowerCase()
			.includes(normalized),
	);
};

export const isSettingsSectionVisible = (
	section: SettingsSectionId,
	isAdmin: boolean,
): boolean =>
	visibleSettingsNavigation(isAdmin).some((item) => item.id === section);
