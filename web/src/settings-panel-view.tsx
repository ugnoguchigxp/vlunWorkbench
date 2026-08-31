import {
	Activity,
	BookOpen,
	Brain,
	Database,
	GitBranch,
	Save,
} from "lucide-react";
import { useState } from "react";
import { LlmProvidersPanel } from "./settings-llm-providers-panel";
import type { SettingsPanelModel } from "./settings-panel";
import { formatDateTime } from "./settings-panel-model";
import type { SettingsSectionId } from "./settings-route-search";
import { RuntimeSettingsPanel } from "./settings-runtime-panel";
import { SettingsShell } from "./settings-shell";
import { TaskRoutingPanel } from "./settings-task-routing-panel";
import { Button, TextArea } from "./ui";

type SettingsPanelViewProps = {
	model: SettingsPanelModel;
	activeSection: SettingsSectionId;
	onSelectSection: (section: SettingsSectionId) => void;
};

export function SettingsPanelView({
	model,
	activeSection,
	onSelectSection,
}: SettingsPanelViewProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const title = activeSection === "overview" ? "概要" : undefined;
	return (
		<SettingsShell
			activeSection={activeSection}
			isAdmin={model.isAdmin}
			searchQuery={searchQuery}
			onSearchQueryChange={setSearchQuery}
			onSearchDismiss={() => setSearchQuery("")}
			onSelectSection={onSelectSection}
		>
			{title ? (
				<section className="settings-section-heading">
					<h2>{title}</h2>
				</section>
			) : null}
			{activeSection === "overview" ? (
				<SettingsOverview model={model} onSelectSection={onSelectSection} />
			) : null}
			{activeSection === "system-context" ? (
				<SystemContextPanel model={model} />
			) : null}
			{activeSection === "ai-models" ? (
				<LlmProvidersPanel model={model} />
			) : null}
			{activeSection === "task-routing" ? (
				<TaskRoutingPanel model={model} />
			) : null}
			{activeSection === "scan-execution" ||
			activeSection === "security" ||
			activeSection === "advanced" ? (
				<RuntimeSettingsPanel model={model} section={activeSection} />
			) : null}
		</SettingsShell>
	);
}

function SettingsOverview({
	model,
	onSelectSection,
}: {
	model: SettingsPanelModel;
	onSelectSection: (section: SettingsSectionId) => void;
}) {
	const {
		appHealth,
		sourceHealth,
		isAdmin,
		llmSettings,
		codexStatus,
		runtimeSettings,
		systemContextUpdatedAt,
	} = model;
	return (
		<div className="settings-overview-grid">
			<section className="panel">
				<div className="panel-header">
					<h2>アプリケーション</h2>
				</div>
				<div className="meta-list compact">
					<div>
						<Activity />
						<span>{appHealth?.status ?? "-"}</span>
					</div>
					<div>
						<Database />
						<span>{appHealth?.service ?? "-"}</span>
					</div>
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
					<h2>設定の状態</h2>
				</div>
				<ul className="settings-summary-list">
					<li>System Context: {formatDateTime(systemContextUpdatedAt)}</li>
					{isAdmin ? (
						<li>
							LLMプロバイダー: {llmSettings?.providerEndpoints.length ?? "-"}件
						</li>
					) : null}
					{isAdmin ? (
						<li>
							Codex:{" "}
							{codexStatus?.authenticated &&
							codexStatus.executableAdapterAvailable
								? "利用可能"
								: "確認が必要"}
						</li>
					) : null}
					{isAdmin ? (
						<li>
							隔離Runtime:{" "}
							{runtimeSettings?.runtimeIsolationConfigured
								? "設定済み"
								: "未設定"}
						</li>
					) : null}
				</ul>
				<div className="actions">
					<Button
						type="button"
						onClick={() => onSelectSection("system-context")}
					>
						<Brain className="icon" />
						コンテキストを編集
					</Button>
					{isAdmin && !runtimeSettings?.runtimeIsolationConfigured ? (
						<Button type="button" onClick={() => onSelectSection("security")}>
							セキュリティ設定を開く
						</Button>
					) : null}
				</div>
			</section>
		</div>
	);
}

function SystemContextPanel({ model }: { model: SettingsPanelModel }) {
	return (
		<section className="panel settings-system-panel">
			<div className="panel-header">
				<div>
					<h2>System Context</h2>
					<small>エージェント検索で使用する指示を編集します。</small>
				</div>
				<Button
					type="button"
					variant="primary"
					onClick={() => void model.handleSaveSystemContext()}
					disabled={model.systemContextSaving || !model.systemContextDirty}
				>
					<Save className="icon" />
					変更を保存
				</Button>
			</div>
			<div className="form-stack">
				<label htmlFor="system-context-input">Agentic Search Prompt</label>
				<TextArea
					id="system-context-input"
					value={model.systemContextText}
					onChange={(event) =>
						model.onSystemContextTextChange(event.target.value)
					}
					placeholder="System context for this user..."
				/>
				<small>
					{model.systemContextDirty
						? "未保存の変更があります"
						: `更新: ${formatDateTime(model.systemContextUpdatedAt)}`}
				</small>
				{model.systemContextError ? (
					<p className="status error">{model.systemContextError}</p>
				) : null}
			</div>
		</section>
	);
}
