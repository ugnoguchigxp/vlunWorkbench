import { KeyRound, Save, WandSparkles } from "lucide-react";
import {
	normalizeRuntimeSettingsResponse,
	type RuntimeSettingsResponse,
} from "./api";
import type { SettingsPanelModel } from "./settings-panel";
import { formatDateTime } from "./settings-panel-model";
import {
	dastAuthKeyStatus,
	NumberSetting,
	RuntimeIsolationTextSetting,
	TextSetting,
} from "./settings-runtime-fields";
import { Button, SelectInput, TextInput } from "./ui";

export function RuntimeCategoryPanel({
	model,
	section,
}: {
	model: SettingsPanelModel;
	section: "scan-execution" | "security" | "advanced";
}) {
	const runtimeSettings = model.runtimeSettings
		? normalizeRuntimeSettingsResponse(model.runtimeSettings)
		: null;
	const title =
		section === "scan-execution"
			? "スキャン実行"
			: section === "security"
				? "セキュリティ"
				: "詳細設定";
	const runtimeBusy =
		model.runtimeSaving ||
		model.runtimeGeneratingDastAuthKey ||
		model.runtimeAutoConfiguring;
	if (!runtimeSettings)
		return (
			<section className="panel">
				<div className="tree-info">設定を読み込んでいます…</div>
			</section>
		);
	const updateIsolation = (
		key: Exclude<
			keyof RuntimeSettingsResponse["runtimeIsolation"],
			"qualificationVersion"
		>,
		value: string,
	) =>
		model.updateRuntimeSetting({
			runtimeIsolation: { ...runtimeSettings.runtimeIsolation, [key]: value },
		});
	return (
		<section className="panel">
			<div className="panel-header">
				<div>
					<h2>{title}</h2>
					<small>
						{section === "scan-execution"
							? "スキャナーの実行方式とDockerリソースを設定します。"
							: section === "security"
								? "隔離実行環境とDAST暗号鍵を管理します。"
								: "処理上限、タイムアウト、任意イメージを設定します。"}
					</small>
				</div>
				<Button
					type="button"
					variant="primary"
					onClick={() => void model.handleSaveRuntimeSettings()}
					disabled={runtimeBusy || !model.runtimeDirty}
				>
					<Save className="icon" />
					変更を保存
				</Button>
			</div>
			{model.runtimeError ? (
				<p className="status error">{model.runtimeError}</p>
			) : null}
			<fieldset className="form-stack" disabled={runtimeBusy}>
				{section === "scan-execution" ? (
					<div className="settings-form-grid">
						<div className="settings-form-field">
							<label htmlFor="runtime-scan-mode">Scanner execution</label>
							<SelectInput
								id="runtime-scan-mode"
								value={runtimeSettings.scanExecutionMode}
								onChange={(event) =>
									model.updateRuntimeSetting({
										scanExecutionMode: event.target.value as "host" | "docker",
									})
								}
							>
								<option value="host">Host</option>
								<option value="docker">Docker</option>
							</SelectInput>
						</div>
						<div className="settings-form-field settings-checkbox-field">
							<span className="settings-field-label">
								Host scanner execution
							</span>
							<label
								className="settings-check-button"
								htmlFor="runtime-allow-host"
							>
								<input
									id="runtime-allow-host"
									type="checkbox"
									checked={runtimeSettings.allowHostScannerExecution}
									onChange={(event) =>
										model.updateRuntimeSetting({
											allowHostScannerExecution: event.target.checked,
										})
									}
								/>
								<span>
									{runtimeSettings.allowHostScannerExecution
										? "Allowed"
										: "Blocked"}
								</span>
							</label>
						</div>
						<TextSetting
							id="runtime-docker-image"
							label="Docker image"
							value={runtimeSettings.scanDockerImage}
							onChange={(scanDockerImage) =>
								model.updateRuntimeSetting({ scanDockerImage })
							}
						/>
						<TextSetting
							id="runtime-docker-memory"
							label="Docker memory"
							value={runtimeSettings.dockerMemory}
							onChange={(dockerMemory) =>
								model.updateRuntimeSetting({ dockerMemory })
							}
						/>
						<NumberSetting
							id="runtime-docker-cpus"
							label="Docker CPUs"
							value={runtimeSettings.dockerCpus}
							step="0.25"
							onChange={(dockerCpus) =>
								model.updateRuntimeSetting({ dockerCpus })
							}
						/>
						<NumberSetting
							id="runtime-docker-pids"
							label="Docker PID limit"
							value={runtimeSettings.dockerPidsLimit}
							onChange={(dockerPidsLimit) =>
								model.updateRuntimeSetting({ dockerPidsLimit })
							}
						/>
					</div>
				) : null}
				{section === "security" ? (
					<>
						<div className="actions">
							<strong>
								{runtimeSettings.runtimeIsolationConfigured
									? "Configured"
									: `Not configured (${runtimeSettings.runtimeIsolationMissingFields.length} required fields missing)`}
							</strong>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void model.handleAutoConfigureRuntimeIsolation()}
								disabled={
									model.runtimeDirty ||
									model.runtimeSaving ||
									model.runtimeAutoConfiguring ||
									model.runtimeGeneratingDastAuthKey
								}
							>
								<WandSparkles className="icon" />
								{model.runtimeAutoConfiguring
									? "Building and verifying..."
									: "Auto-configure local runtime"}
							</Button>
						</div>
						<small>
							Qualification contract: v
							{runtimeSettings.runtimeIsolation.qualificationVersion}
						</small>
						{model.runtimeDirty ? (
							<small>先に変更を保存してください</small>
						) : null}
						<div className="settings-form-grid">
							{(
								[
									["namespaceOwnerImage", "Namespace owner image"],
									["nodeImage", "Node runtime image"],
									["materializerImage", "Materializer image"],
									["registryProxyImage", "Registry proxy image"],
									["probeImage", "Readiness probe image"],
									["httpExecutorImage", "HTTP executor image"],
									["dockerDaemonIdentityHash", "Docker daemon identity hash"],
									["qualificationHash", "Qualification hash"],
								] as const
							).map(([key, label]) => (
								<RuntimeIsolationTextSetting
									key={key}
									id={`runtime-isolation-${key}`}
									label={label}
									value={runtimeSettings.runtimeIsolation[key]}
									onChange={(value) => updateIsolation(key, value)}
								/>
							))}
						</div>
						<div className="settings-form-field">
							<label htmlFor="runtime-dast-auth-key">
								DAST auth encryption key
							</label>
							<TextInput
								id="runtime-dast-auth-key"
								type="password"
								value={runtimeSettings.dastAuthEncryptionKey}
								onChange={(event) =>
									model.updateRuntimeSetting({
										dastAuthEncryptionKey: event.target.value,
									})
								}
								autoComplete="new-password"
							/>
							<div className="actions">
								<small>
									{dastAuthKeyStatus(
										runtimeSettings.dastAuthEncryptionKeyConfigured,
										runtimeSettings.dastAuthEncryptionKeySource,
									)}
								</small>
								<Button
									type="button"
									variant="secondary"
									onClick={() => void model.handleGenerateDastAuthKey()}
									disabled={
										model.runtimeDirty ||
										model.runtimeSaving ||
										model.runtimeGeneratingDastAuthKey ||
										model.runtimeAutoConfiguring
									}
								>
									<KeyRound className="icon" />
									{runtimeSettings.dastAuthEncryptionKeyConfigured
										? "Generate and rotate"
										: "Generate and save"}
								</Button>
							</div>
						</div>
					</>
				) : null}
				{section === "advanced" ? (
					<div className="settings-form-grid">
						{(
							[
								["scannerStdoutLimitBytes", "Scanner stdout limit (bytes)"],
								["scannerStderrLimitBytes", "Scanner stderr limit (bytes)"],
								["webProcessConcurrency", "Web process concurrency"],
								["webScanQueueLimit", "Web scan queue limit"],
								["webScanStepTimeoutMaxSec", "Web scan step timeout max (sec)"],
								[
									"webScanWallClockTimeoutSec",
									"Web scan wall-clock timeout (sec)",
								],
								["codexSdkTimeoutMs", "Codex timeout (ms)"],
							] as const
						).map(([key, label]) => (
							<NumberSetting
								key={key}
								id={`runtime-${key}`}
								label={label}
								value={runtimeSettings[key]}
								onChange={(value) =>
									model.updateRuntimeSetting({ [key]: value })
								}
							/>
						))}
						{(
							[
								["postgresImage", "PostgreSQL image"],
								["mysqlImage", "MySQL image"],
								["nucleiImage", "Nuclei image"],
								["zapImage", "ZAP image"],
								["schemathesisImage", "Schemathesis image"],
							] as const
						).map(([key, label]) => (
							<RuntimeIsolationTextSetting
								key={key}
								id={`runtime-isolation-${key}`}
								label={label}
								value={runtimeSettings.runtimeIsolation[key]}
								onChange={(value) => updateIsolation(key, value)}
							/>
						))}
					</div>
				) : null}
				<small>更新: {formatDateTime(runtimeSettings.updatedAt)}</small>
			</fieldset>
		</section>
	);
}
