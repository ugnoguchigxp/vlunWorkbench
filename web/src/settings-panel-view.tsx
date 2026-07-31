import { Activity, BookOpen, Brain, Database, GitBranch } from "lucide-react";
import { Button, TextArea } from "./ui";
import { formatDateTime } from "./settings-panel-model";
import type { SettingsPanelModel } from "./settings-panel";
import { LlmProvidersPanel } from "./settings-llm-providers-panel";
import { TaskRoutingPanel } from "./settings-task-routing-panel";
import { RuntimeSettingsPanel } from "./settings-runtime-panel";

export function SettingsPanelView({ model }: { model: SettingsPanelModel }) {
	const {
		appHealth,
		sourceHealth,
		systemContextText,
		systemContextUpdatedAt,
		systemContextSaving,
		onSystemContextTextChange,
		handleSaveSystemContext,
	} = model;
	return (
		<main className="layout settings-layout">
			<section className="panel">
				<div className="panel-header">
					<h2>Runtime</h2>
				</div>
				<div className="settings-grid-2">
					<div className="meta-list compact">
						<div>
							<Activity />
							<span>{appHealth?.status ?? "-"}</span>
						</div>
						<div>
							<Database />
							<span>{appHealth?.service ?? "-"}</span>
						</div>
					</div>
					<div className="meta-list compact">
						<div>
							<GitBranch />
							<span>{sourceHealth?.git?.branch ?? "-"}</span>
						</div>
						<div>
							<BookOpen />
							<span>{sourceHealth?.git?.commit ?? "-"}</span>
						</div>
					</div>
				</div>
			</section>
			<section className="panel settings-system-panel">
				<div className="panel-header">
					<h2>System Context</h2>
				</div>
				<div className="form-stack">
					<label htmlFor="system-context-input">Agentic Search Prompt</label>
					<TextArea
						id="system-context-input"
						value={systemContextText}
						onChange={(event) => onSystemContextTextChange(event.target.value)}
						placeholder="System context for this user..."
					/>
					<div className="actions">
						<Button
							type="button"
							variant="primary"
							onClick={() => void handleSaveSystemContext()}
							disabled={systemContextSaving}
						>
							<Brain className="icon" />
							<span>Save</span>
						</Button>
						<small>updated: {formatDateTime(systemContextUpdatedAt)}</small>
					</div>
				</div>
			</section>
			<RuntimeSettingsPanel model={model} />
			<LlmProvidersPanel model={model} />
			<TaskRoutingPanel model={model} />
		</main>
	);
}
