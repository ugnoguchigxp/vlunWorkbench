import { KeyRound, RefreshCw, Save, SlidersHorizontal } from "lucide-react";
import type { SettingsPanelModel } from "./settings-panel";
import { formatDateTime } from "./settings-panel-model";
import { Button, SelectInput, TextInput } from "./ui";

const toNumber = (value: string, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export function RuntimeSettingsPanel({ model }: { model: SettingsPanelModel }) {
	const {
		isAdmin,
		runtimeSettings,
		runtimeSaving,
		runtimeGeneratingDastAuthKey,
		updateRuntimeSetting,
		handleSaveRuntimeSettings,
		handleGenerateDastAuthKey,
	} = model;
	if (!isAdmin) return null;

	return (
		<section className="panel">
			<div className="panel-header">
				<div>
					<h2>Runtime Settings</h2>
					<small>Scanner policy and process limits stored in SQLite.</small>
				</div>
				<Button
					type="button"
					variant="primary"
					onClick={() => void handleSaveRuntimeSettings()}
					disabled={!runtimeSettings || runtimeSaving}
				>
					<Save className="icon" />
					<span>Save</span>
				</Button>
			</div>
			{runtimeSettings ? (
				<div className="form-stack">
					<div className="settings-form-grid">
						<div className="settings-form-field">
							<label htmlFor="runtime-scan-mode">Scanner execution</label>
							<SelectInput
								id="runtime-scan-mode"
								value={runtimeSettings.scanExecutionMode}
								onChange={(event) =>
									updateRuntimeSetting({
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
										updateRuntimeSetting({
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
						<div className="settings-form-field">
							<label htmlFor="runtime-docker-image">Docker image</label>
							<TextInput
								id="runtime-docker-image"
								value={runtimeSettings.scanDockerImage}
								onChange={(event) =>
									updateRuntimeSetting({
										scanDockerImage: event.target.value,
									})
								}
							/>
						</div>
						<div className="settings-form-field">
							<label htmlFor="runtime-docker-memory">Docker memory</label>
							<TextInput
								id="runtime-docker-memory"
								value={runtimeSettings.dockerMemory}
								onChange={(event) =>
									updateRuntimeSetting({ dockerMemory: event.target.value })
								}
							/>
						</div>
						<NumberSetting
							id="runtime-docker-cpus"
							label="Docker CPUs"
							value={runtimeSettings.dockerCpus}
							step="0.25"
							onChange={(dockerCpus) => updateRuntimeSetting({ dockerCpus })}
						/>
						<NumberSetting
							id="runtime-docker-pids"
							label="Docker PID limit"
							value={runtimeSettings.dockerPidsLimit}
							onChange={(dockerPidsLimit) =>
								updateRuntimeSetting({ dockerPidsLimit })
							}
						/>
						<NumberSetting
							id="runtime-stdout-limit"
							label="Scanner stdout limit (bytes)"
							value={runtimeSettings.scannerStdoutLimitBytes}
							onChange={(scannerStdoutLimitBytes) =>
								updateRuntimeSetting({ scannerStdoutLimitBytes })
							}
						/>
						<NumberSetting
							id="runtime-stderr-limit"
							label="Scanner stderr limit (bytes)"
							value={runtimeSettings.scannerStderrLimitBytes}
							onChange={(scannerStderrLimitBytes) =>
								updateRuntimeSetting({ scannerStderrLimitBytes })
							}
						/>
						<NumberSetting
							id="runtime-web-process-concurrency"
							label="Web process concurrency"
							value={runtimeSettings.webProcessConcurrency}
							onChange={(webProcessConcurrency) =>
								updateRuntimeSetting({ webProcessConcurrency })
							}
						/>
						<NumberSetting
							id="runtime-web-scan-queue-limit"
							label="Web scan queue limit"
							value={runtimeSettings.webScanQueueLimit}
							onChange={(webScanQueueLimit) =>
								updateRuntimeSetting({ webScanQueueLimit })
							}
						/>
						<NumberSetting
							id="runtime-web-scan-step-timeout"
							label="Web scan step timeout max (sec)"
							value={runtimeSettings.webScanStepTimeoutMaxSec}
							onChange={(webScanStepTimeoutMaxSec) =>
								updateRuntimeSetting({ webScanStepTimeoutMaxSec })
							}
						/>
						<NumberSetting
							id="runtime-web-scan-wall-clock-timeout"
							label="Web scan wall-clock timeout (sec)"
							value={runtimeSettings.webScanWallClockTimeoutSec}
							onChange={(webScanWallClockTimeoutSec) =>
								updateRuntimeSetting({ webScanWallClockTimeoutSec })
							}
						/>
						<NumberSetting
							id="runtime-codex-timeout"
							label="Codex timeout (ms)"
							value={runtimeSettings.codexSdkTimeoutMs}
							onChange={(codexSdkTimeoutMs) =>
								updateRuntimeSetting({ codexSdkTimeoutMs })
							}
						/>
						<div className="settings-form-field settings-field-wide">
							<label htmlFor="runtime-dast-auth-key">
								DAST auth encryption key
							</label>
							<TextInput
								id="runtime-dast-auth-key"
								type="password"
								value={runtimeSettings.dastAuthEncryptionKey}
								onChange={(event) =>
									updateRuntimeSetting({
										dastAuthEncryptionKey: event.target.value,
									})
								}
								placeholder={
									runtimeSettings.dastAuthEncryptionKeyConfigured
										? "Configured — enter a new key only to rotate"
										: "Base64-encoded 32-byte key"
								}
								autoComplete="new-password"
							/>
							<div className="actions">
								<KeyRound className="icon" />
								<small>
									{dastAuthKeyStatus(
										runtimeSettings.dastAuthEncryptionKeyConfigured,
										runtimeSettings.dastAuthEncryptionKeySource,
									)}
								</small>
								<Button
									type="button"
									variant="secondary"
									onClick={() => void handleGenerateDastAuthKey()}
									disabled={runtimeSaving || runtimeGeneratingDastAuthKey}
								>
									<RefreshCw className="icon" />
									<span>
										{runtimeSettings.dastAuthEncryptionKeyConfigured
											? "Generate and rotate"
											: "Generate and save"}
									</span>
								</Button>
							</div>
						</div>
					</div>
					<div className="actions">
						<SlidersHorizontal className="icon" />
						<small>updated: {formatDateTime(runtimeSettings.updatedAt)}</small>
					</div>
				</div>
			) : (
				<div className="tree-info">Loading runtime settings...</div>
			)}
		</section>
	);
}

function dastAuthKeyStatus(
	configured: boolean,
	source: "environment" | "settings" | "none",
): string {
	if (!configured) return "Not configured";
	return source === "environment"
		? "Configured by DAST_AUTH_ENCRYPTION_KEY"
		: "Configured in encrypted runtime settings";
}

function NumberSetting({
	id,
	label,
	value,
	step,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	step?: string;
	onChange: (value: number) => void;
}) {
	return (
		<div className="settings-form-field">
			<label htmlFor={id}>{label}</label>
			<TextInput
				id={id}
				type="number"
				min="0"
				step={step ?? "1"}
				value={value}
				onChange={(event) => onChange(toNumber(event.target.value, value))}
			/>
		</div>
	);
}
