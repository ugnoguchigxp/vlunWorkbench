import type { ScanWorkspaceTab } from "../scans-route-search";

const tabs: Array<{ id: ScanWorkspaceTab; label: string }> = [
	{ id: "overview", label: "概要・検出結果" },
	{ id: "coverage", label: "カバレッジ" },
	{ id: "report", label: "レポート" },
];

export function ScanTabs({
	activeTab,
	onChange,
}: {
	activeTab: ScanWorkspaceTab;
	onChange: (tab: ScanWorkspaceTab) => void;
}) {
	return (
		<div
			className="workspace-tabs"
			role="tablist"
			aria-label="スキャンワークスペース"
		>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					role="tab"
					aria-label={tab.id === "report" ? "レポート MD" : undefined}
					aria-selected={activeTab === tab.id}
					className={activeTab === tab.id ? "active" : ""}
					onClick={() => onChange(tab.id)}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}
