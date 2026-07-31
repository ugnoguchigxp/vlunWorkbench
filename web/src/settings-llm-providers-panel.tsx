import {
	CheckCircle2,
	Plus,
	RefreshCw,
	Save,
	Trash2,
	XCircle,
} from "lucide-react";
import { fetchCodexStatus, type LlmProviderKind } from "./api";
import { Button, SelectInput, TextArea, TextInput } from "./ui";
import {
	ensureCodexEndpoint,
	formatModelDisplayNames,
	modelText,
	parseModelDisplayNames,
	parseModels,
	PROVIDER_KINDS,
	providerKindLabels,
} from "./settings-panel-model";
import type { SettingsPanelModel } from "./settings-panel";

export function LlmProvidersPanel({ model }: { model: SettingsPanelModel }) {
	const {
		isAdmin,
		llmLoading,
		llmSettings,
		codexStatus,
		setCodexStatus,
		setLlmSettings,
		codexEndpoint,
		genericEndpoints,
		healthByEndpointId,
		selectedEndpointId,
		setSelectedEndpointId,
		selectedEndpoint,
		updateCodexEndpoint,
		updateEndpoint,
		handleAddEndpoint,
		handleDeleteEndpoint,
		handleSaveLlmSettings,
		handleHealth,
		healthCheckingId,
		llmSaveDisabled,
	} = model;
	if (!isAdmin) return null;
	return (
		<>
			<section className="panel llm-settings-panel">
				<div className="panel-header">
					<h2>LLM Providers</h2>
					<div className="actions">
						<Button type="button" onClick={handleAddEndpoint}>
							<Plus className="icon" />
							<span>Add</span>
						</Button>
						<Button
							type="button"
							variant="primary"
							onClick={() => void handleSaveLlmSettings()}
							disabled={llmSaveDisabled}
						>
							<Save className="icon" />
							<span>Save</span>
						</Button>
					</div>
				</div>

				{llmLoading ? (
					<div className="tree-info">Loading LLM settings...</div>
				) : null}

				{llmSettings ? (
					<div className="llm-settings-grid">
						<div className="codex-status-card">
							<div className="codex-status-header">
								<div>
									<strong>Codex SDK</strong>
									<small>{codexStatus?.codexHome ?? "-"}</small>
								</div>
								<div className="actions">
									<Button
										type="button"
										onClick={async () => {
											const next = await fetchCodexStatus();
											setCodexStatus(next);
											setLlmSettings((current) =>
												current ? ensureCodexEndpoint(current, next) : current,
											);
										}}
									>
										<RefreshCw className="icon" />
									</Button>
									<Button
										type="button"
										variant="primary"
										onClick={() => void handleSaveLlmSettings()}
										disabled={llmSaveDisabled}
									>
										<Save className="icon" />
										<span>Save</span>
									</Button>
								</div>
							</div>
							<div className="codex-status-values">
								<span
									className={
										codexStatus?.authenticated ? "health-ok" : "health-fail"
									}
								>
									{codexStatus?.authSource ?? "unchecked"}
								</span>
								<span>{codexStatus?.modelSource ?? "-"}</span>
								<span>
									{codexStatus?.detectedModels.length
										? `${codexStatus.detectedModels.length} models`
										: "-"}
								</span>
								<span
									className={
										codexStatus?.executableAdapterAvailable
											? "health-ok"
											: "health-fail"
									}
								>
									{codexStatus?.executableAdapterAvailable
										? "adapter ready"
										: "adapter unavailable"}
								</span>
							</div>
							{codexEndpoint ? (
								<div className="codex-settings-grid">
									<div className="settings-form-field">
										<label htmlFor="codex-enabled">Codex SDK</label>
										<SelectInput
											id="codex-enabled"
											value={codexEndpoint.enabled ? "true" : "false"}
											onChange={(event) =>
												updateCodexEndpoint({
													enabled: event.target.value === "true",
												})
											}
										>
											<option value="true">Enabled</option>
											<option value="false">Disabled</option>
										</SelectInput>
									</div>
									<div className="settings-form-field">
										<label htmlFor="codex-token">Access Token Override</label>
										<TextInput
											id="codex-token"
											type="password"
											value={codexEndpoint.apiKey}
											onChange={(event) =>
												updateCodexEndpoint({
													apiKey: event.target.value,
												})
											}
										/>
									</div>
									<div className="settings-form-field settings-field-wide">
										<label htmlFor="codex-models">Models</label>
										<TextInput
											id="codex-models"
											value={modelText(codexEndpoint)}
											onChange={(event) =>
												updateCodexEndpoint({
													models: parseModels(event.target.value),
												})
											}
										/>
									</div>
								</div>
							) : null}
						</div>
						<div className="endpoint-list">
							{genericEndpoints.map((endpoint) => {
								const health = healthByEndpointId[endpoint.id];
								return (
									<button
										type="button"
										key={endpoint.id}
										className={[
											"endpoint-row",
											selectedEndpointId === endpoint.id ? "active" : "",
										]
											.filter(Boolean)
											.join(" ")}
										onClick={() => setSelectedEndpointId(endpoint.id)}
									>
										<span>
											<strong>{endpoint.name}</strong>
											<small>{endpoint.kind}</small>
										</span>
										{health ? (
											health.ok ? (
												<CheckCircle2 className="icon health-ok" />
											) : (
												<XCircle className="icon health-fail" />
											)
										) : null}
									</button>
								);
							})}
						</div>

						{selectedEndpoint ? (
							<div className="endpoint-editor">
								<div className="provider-editor-header">
									<div className="settings-form-field">
										<label htmlFor={`llm-name-${selectedEndpoint.id}`}>
											Name
										</label>
										<TextInput
											id={`llm-name-${selectedEndpoint.id}`}
											value={selectedEndpoint.name}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													name: event.target.value,
												})
											}
										/>
									</div>
									<div className="settings-form-field">
										<label htmlFor={`llm-kind-${selectedEndpoint.id}`}>
											Kind
										</label>
										<SelectInput
											id={`llm-kind-${selectedEndpoint.id}`}
											value={selectedEndpoint.kind}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
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
									</div>
									<div className="settings-form-field settings-checkbox-field">
										<span className="settings-field-label">Enabled</span>
										<label
											className="settings-check-button"
											htmlFor={`llm-enabled-${selectedEndpoint.id}`}
										>
											<input
												id={`llm-enabled-${selectedEndpoint.id}`}
												type="checkbox"
												checked={selectedEndpoint.enabled}
												onChange={(event) =>
													updateEndpoint(selectedEndpoint.id, {
														enabled: event.target.checked,
													})
												}
											/>
											<span>
												{selectedEndpoint.enabled ? "Enabled" : "Disabled"}
											</span>
										</label>
									</div>
								</div>
								<div className="settings-form-grid">
									{selectedEndpoint.kind === "azure" ? (
										<>
											<div className="settings-form-field">
												<label htmlFor={`llm-endpoint-${selectedEndpoint.id}`}>
													Endpoint
												</label>
												<TextInput
													id={`llm-endpoint-${selectedEndpoint.id}`}
													value={selectedEndpoint.endpoint ?? ""}
													onChange={(event) =>
														updateEndpoint(selectedEndpoint.id, {
															endpoint: event.target.value,
														})
													}
												/>
											</div>
											<div className="settings-form-field">
												<label
													htmlFor={`llm-api-version-${selectedEndpoint.id}`}
												>
													API Version
												</label>
												<TextInput
													id={`llm-api-version-${selectedEndpoint.id}`}
													value={selectedEndpoint.apiVersion ?? ""}
													onChange={(event) =>
														updateEndpoint(selectedEndpoint.id, {
															apiVersion: event.target.value,
														})
													}
												/>
											</div>
										</>
									) : null}
									{selectedEndpoint.kind === "bedrock" ? (
										<div className="settings-form-field">
											<label htmlFor={`llm-region-${selectedEndpoint.id}`}>
												Region
											</label>
											<TextInput
												id={`llm-region-${selectedEndpoint.id}`}
												value={selectedEndpoint.region ?? ""}
												onChange={(event) =>
													updateEndpoint(selectedEndpoint.id, {
														region: event.target.value,
													})
												}
											/>
										</div>
									) : null}
									{selectedEndpoint.kind === "openai" ||
									selectedEndpoint.kind === "openai-compatible" ||
									selectedEndpoint.kind === "local" ? (
										<div className="settings-form-field">
											<label htmlFor={`llm-base-url-${selectedEndpoint.id}`}>
												Base URL
											</label>
											<TextInput
												id={`llm-base-url-${selectedEndpoint.id}`}
												value={selectedEndpoint.baseUrl ?? ""}
												onChange={(event) =>
													updateEndpoint(selectedEndpoint.id, {
														baseUrl: event.target.value,
													})
												}
											/>
										</div>
									) : null}
									<div className="settings-form-field">
										<label htmlFor={`llm-api-key-${selectedEndpoint.id}`}>
											API Key
										</label>
										<TextInput
											id={`llm-api-key-${selectedEndpoint.id}`}
											type="password"
											value={selectedEndpoint.apiKey}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													apiKey: event.target.value,
												})
											}
										/>
									</div>
									<div className="settings-form-field settings-field-wide">
										<label htmlFor={`llm-models-${selectedEndpoint.id}`}>
											Models
										</label>
										<TextInput
											id={`llm-models-${selectedEndpoint.id}`}
											value={modelText(selectedEndpoint)}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													models: parseModels(event.target.value),
												})
											}
										/>
									</div>
									<div className="settings-form-field settings-field-wide">
										<label htmlFor={`llm-model-labels-${selectedEndpoint.id}`}>
											Model Select Labels
										</label>
										<TextArea
											id={`llm-model-labels-${selectedEndpoint.id}`}
											value={formatModelDisplayNames(
												selectedEndpoint.modelDisplayNames,
											)}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													modelDisplayNames: parseModelDisplayNames(
														event.target.value,
													),
												})
											}
											placeholder="gpt-4.1=Review JSON (Azure)"
										/>
									</div>
								</div>
								<div className="actions">
									<Button
										type="button"
										onClick={() => void handleHealth(selectedEndpoint.id)}
										disabled={healthCheckingId === selectedEndpoint.id}
									>
										<RefreshCw className="icon" />
										<span>Health</span>
									</Button>
									<Button
										type="button"
										variant="primary"
										onClick={() => void handleSaveLlmSettings()}
										disabled={llmSaveDisabled}
									>
										<Save className="icon" />
										<span>Save</span>
									</Button>
									<Button
										type="button"
										variant="destructive"
										onClick={() => handleDeleteEndpoint(selectedEndpoint.id)}
									>
										<Trash2 className="icon" />
										<span>Remove</span>
									</Button>
									{healthByEndpointId[selectedEndpoint.id]?.message ? (
										<small>
											{healthByEndpointId[selectedEndpoint.id]?.message}
										</small>
									) : null}
								</div>
							</div>
						) : null}
					</div>
				) : null}
			</section>
		</>
	);
}
