import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import type { LlmProviderKind } from "./api";
import type { SettingsPanelModel } from "./settings-panel";
import {
	deriveProviderStatus,
	formatModelDisplayNames,
	modelText,
	PROVIDER_KINDS,
	parseModelDisplayNames,
	parseModels,
	providerKindLabels,
} from "./settings-panel-model";
import { Button, SelectInput, TextArea, TextInput } from "./ui";

export function LlmProvidersPanel({ model }: { model: SettingsPanelModel }) {
	if (!model.isAdmin) return null;
	const selected = model.selectedProvider;
	return (
		<section className="panel llm-settings-panel">
			<div className="panel-header">
				<div>
					<h2>AI・モデル</h2>
					<small>
						診断・レビューに使用するプロバイダーとモデルを管理します。
					</small>
				</div>
				<div className="actions">
					<Button
						type="button"
						onClick={model.handleAddEndpoint}
						disabled={!model.llmSettings || model.llmLoading}
					>
						<Plus className="icon" />
						プロバイダーを追加
					</Button>
					<Button
						type="button"
						variant="primary"
						onClick={() => void model.handleSaveLlmSettings()}
						disabled={model.llmSaveDisabled}
					>
						<Save className="icon" />
						変更を保存
					</Button>
				</div>
			</div>
			{model.llmLoading ? (
				<div className="tree-info">設定を読み込んでいます…</div>
			) : null}
			{model.llmError ? <p className="status error">{model.llmError}</p> : null}
			{model.llmSettings ? (
				<div className="llm-settings-grid">
					<section className="endpoint-list" aria-label="プロバイダー一覧">
						{model.llmSettings.providerEndpoints.map((endpoint) => {
							const status = deriveProviderStatus(
								endpoint,
								model.codexStatus,
								model.healthByEndpointId[endpoint.id],
							);
							return (
								<button
									type="button"
									key={endpoint.id}
									className={[
										"endpoint-row",
										model.selectedProviderId === endpoint.id ? "active" : "",
									]
										.filter(Boolean)
										.join(" ")}
									onClick={() => model.setSelectedProviderId(endpoint.id)}
								>
									<span>
										<strong>{endpoint.name}</strong>
										<small>{providerKindLabels[endpoint.kind]}</small>
									</span>
									<small className={`provider-status ${status.tone}`}>
										{status.label}
									</small>
								</button>
							);
						})}
					</section>
					{selected ? <ProviderEditor model={model} /> : null}
				</div>
			) : null}
			{model.validationErrors.length ? (
				<div className="settings-validation">
					{model.validationErrors.map((error) => (
						<div key={error}>{error}</div>
					))}
				</div>
			) : null}
		</section>
	);
}

function ProviderEditor({ model }: { model: SettingsPanelModel }) {
	const endpoint = model.selectedProvider;
	if (!endpoint) return null;
	const codex = endpoint.kind === "codex";
	const status = deriveProviderStatus(
		endpoint,
		model.codexStatus,
		model.healthByEndpointId[endpoint.id],
	);
	return (
		<div className="endpoint-editor">
			<div className="provider-editor-header">
				<div>
					<h3>{codex ? "Codex SDK" : endpoint.name}</h3>
					<small className={`provider-status ${status.tone}`}>
						{status.label}
					</small>
				</div>
				{codex ? (
					<Button type="button" onClick={() => void model.refreshCodexStatus()}>
						<RefreshCw className="icon" />
						状態を再取得
					</Button>
				) : null}
			</div>
			{codex ? (
				<div className="codex-status-values">
					<span>{model.codexStatus?.authSource ?? "unchecked"}</span>
					<span>{model.codexStatus?.modelSource ?? "-"}</span>
					<span>
						{model.codexStatus?.executableAdapterAvailable
							? "adapter ready"
							: "adapter unavailable"}
					</span>
				</div>
			) : null}
			<div className="settings-form-grid">
				<div className="settings-form-field">
					<label htmlFor={`llm-name-${endpoint.id}`}>名前</label>
					<TextInput
						id={`llm-name-${endpoint.id}`}
						value={endpoint.name}
						readOnly={codex}
						onChange={(event) =>
							model.updateEndpoint(endpoint.id, { name: event.target.value })
						}
					/>
				</div>
				<div className="settings-form-field">
					<label htmlFor={`llm-kind-${endpoint.id}`}>種別</label>
					{codex ? (
						<TextInput
							id={`llm-kind-${endpoint.id}`}
							value="Codex SDK"
							readOnly
						/>
					) : (
						<SelectInput
							id={`llm-kind-${endpoint.id}`}
							value={endpoint.kind}
							onChange={(event) =>
								model.updateEndpoint(endpoint.id, {
									kind: event.target.value as LlmProviderKind,
								})
							}
						>
							{PROVIDER_KINDS.map((kind) => (
								<option key={kind} value={kind}>
									{providerKindLabels[kind]}
								</option>
							))}
						</SelectInput>
					)}
				</div>
				<div className="settings-form-field settings-checkbox-field">
					<span className="settings-field-label">有効</span>
					<label
						className="settings-check-button"
						htmlFor={`llm-enabled-${endpoint.id}`}
					>
						<input
							id={`llm-enabled-${endpoint.id}`}
							type="checkbox"
							checked={endpoint.enabled}
							onChange={(event) =>
								model.updateEndpoint(endpoint.id, {
									enabled: event.target.checked,
								})
							}
						/>
						<span>{endpoint.enabled ? "Enabled" : "Disabled"}</span>
					</label>
				</div>
				{endpoint.kind === "azure" ? (
					<>
						<TextField
							id={`llm-endpoint-${endpoint.id}`}
							label="Endpoint"
							value={endpoint.endpoint ?? ""}
							onChange={(endpointValue) =>
								model.updateEndpoint(endpoint.id, { endpoint: endpointValue })
							}
						/>
						<TextField
							id={`llm-api-version-${endpoint.id}`}
							label="API Version"
							value={endpoint.apiVersion ?? ""}
							onChange={(apiVersion) =>
								model.updateEndpoint(endpoint.id, { apiVersion })
							}
						/>
					</>
				) : null}
				{endpoint.kind === "bedrock" ? (
					<TextField
						id={`llm-region-${endpoint.id}`}
						label="Region"
						value={endpoint.region ?? ""}
						onChange={(region) => model.updateEndpoint(endpoint.id, { region })}
					/>
				) : null}
				{endpoint.kind === "openai" ||
				endpoint.kind === "openai-compatible" ||
				endpoint.kind === "local" ? (
					<TextField
						id={`llm-base-url-${endpoint.id}`}
						label="Base URL"
						value={endpoint.baseUrl ?? ""}
						onChange={(baseUrl) =>
							model.updateEndpoint(endpoint.id, { baseUrl })
						}
					/>
				) : null}
				<TextField
					id={`llm-api-key-${endpoint.id}`}
					label={codex ? "Access Token Override" : "API Key"}
					type="password"
					value={endpoint.apiKey}
					onChange={(apiKey) => model.updateEndpoint(endpoint.id, { apiKey })}
				/>
				<div className="settings-form-field settings-field-wide">
					<label htmlFor={`llm-models-${endpoint.id}`}>利用可能なモデル</label>
					<TextInput
						id={`llm-models-${endpoint.id}`}
						value={modelText(endpoint)}
						onChange={(event) =>
							model.updateEndpoint(endpoint.id, {
								models: parseModels(event.target.value),
							})
						}
					/>
					<small>カンマ区切りで入力</small>
				</div>
				{!codex ? (
					<details className="settings-form-field settings-field-wide">
						<summary>表示名の詳細設定</summary>
						<TextArea
							id={`llm-model-labels-${endpoint.id}`}
							value={formatModelDisplayNames(endpoint.modelDisplayNames)}
							onChange={(event) =>
								model.updateEndpoint(endpoint.id, {
									modelDisplayNames: parseModelDisplayNames(event.target.value),
								})
							}
							placeholder="gpt-4.1=Review JSON (Azure)"
						/>
					</details>
				) : null}
			</div>
			{!codex ? (
				<div className="actions">
					<Button
						type="button"
						onClick={() => void model.handleHealth(endpoint.id)}
						disabled={
							model.llmSaving ||
							model.healthCheckingId === endpoint.id ||
							model.llmProviderDirty
						}
					>
						<RefreshCw className="icon" />
						接続を確認
					</Button>
					{model.llmProviderDirty ? <small>保存後に確認できます</small> : null}
					<Button
						type="button"
						variant="destructive"
						onClick={() => model.handleDeleteEndpoint(endpoint.id)}
					>
						<Trash2 className="icon" />
						削除
					</Button>
				</div>
			) : null}
		</div>
	);
}

function TextField({
	id,
	label,
	type,
	value,
	onChange,
}: {
	id: string;
	label: string;
	type?: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="settings-form-field">
			<label htmlFor={id}>{label}</label>
			<TextInput
				id={id}
				type={type}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}
