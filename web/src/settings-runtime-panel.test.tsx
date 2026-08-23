import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SettingsPanelModel } from "./settings-panel";
import { RuntimeSettingsPanel } from "./settings-runtime-panel";

describe("RuntimeSettingsPanel", () => {
	it("renders a legacy runtime response without crashing", () => {
		const markup = renderToStaticMarkup(
			<RuntimeSettingsPanel
				model={
					{
						isAdmin: true,
						runtimeSaving: false,
						runtimeGeneratingDastAuthKey: false,
						runtimeAutoConfiguring: false,
						updateRuntimeSetting: vi.fn(),
						handleSaveRuntimeSettings: vi.fn(),
						handleGenerateDastAuthKey: vi.fn(),
						handleAutoConfigureRuntimeIsolation: vi.fn(),
						runtimeSettings: {
							scanExecutionMode: "docker",
							allowHostScannerExecution: false,
							scanDockerImage: "scanner:stable",
							dockerMemory: "2g",
							dockerCpus: 2,
							dockerPidsLimit: 512,
							scannerStdoutLimitBytes: 64 * 1024 * 1024,
							scannerStderrLimitBytes: 8 * 1024 * 1024,
							webProcessConcurrency: 2,
							webScanQueueLimit: 32,
							webScanStepTimeoutMaxSec: 3_600,
							webScanWallClockTimeoutSec: 21_600,
							codexSdkTimeoutMs: 600_000,
							dastAuthEncryptionKey: "",
							dastAuthEncryptionKeyConfigured: false,
							dastAuthEncryptionKeySource: "none",
							updatedAt: null,
						},
					} as unknown as SettingsPanelModel
				}
			/>,
		);

		expect(markup).toContain("8 required fields missing");
		expect(markup).toContain("Namespace owner image");
		expect(markup).toContain("Auto-configure local runtime");
	});

	it("renders SQLite-backed isolated runtime settings for administrators", () => {
		const markup = renderToStaticMarkup(
			<RuntimeSettingsPanel
				model={
					{
						isAdmin: true,
						runtimeSaving: false,
						runtimeGeneratingDastAuthKey: false,
						runtimeAutoConfiguring: false,
						updateRuntimeSetting: vi.fn(),
						handleSaveRuntimeSettings: vi.fn(),
						handleGenerateDastAuthKey: vi.fn(),
						handleAutoConfigureRuntimeIsolation: vi.fn(),
						runtimeSettings: {
							scanExecutionMode: "docker",
							allowHostScannerExecution: false,
							scanDockerImage: "scanner:stable",
							dockerMemory: "2g",
							dockerCpus: 2,
							dockerPidsLimit: 512,
							scannerStdoutLimitBytes: 64 * 1024 * 1024,
							scannerStderrLimitBytes: 8 * 1024 * 1024,
							webProcessConcurrency: 2,
							webScanQueueLimit: 32,
							webScanStepTimeoutMaxSec: 3_600,
							webScanWallClockTimeoutSec: 21_600,
							codexSdkTimeoutMs: 600_000,
							runtimeIsolation: {
								namespaceOwnerImage: "",
								nodeImage: "node@sha256:pinned",
								materializerImage: "materializer@sha256:pinned",
								registryProxyImage: "proxy@sha256:pinned",
								probeImage: "probe@sha256:pinned",
								httpExecutorImage: "executor@sha256:pinned",
								dockerDaemonIdentityHash: "sha256:pinned",
								qualificationHash: "",
								postgresImage: "",
								mysqlImage: "",
								nucleiImage: "",
								zapImage: "",
								schemathesisImage: "",
							},
							runtimeIsolationConfigured: false,
							runtimeIsolationMissingFields: [
								"namespaceOwnerImage",
								"qualificationHash",
							],
							dastAuthEncryptionKey: "",
							dastAuthEncryptionKeyConfigured: false,
							dastAuthEncryptionKeySource: "none",
							updatedAt: null,
						},
					} as unknown as SettingsPanelModel
				}
			/>,
		);

		expect(markup).toContain("Isolated runtime target");
		expect(markup).toContain("Namespace owner image");
		expect(markup).toContain("Docker daemon identity hash");
		expect(markup).toContain("Qualification hash");
		expect(markup).toContain("2 required fields missing");
	});
});
