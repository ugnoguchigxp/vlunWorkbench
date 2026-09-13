/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmSettingsResponse, RuntimeSettingsResponse } from "./api";
import * as api from "./api";
import {
	type SettingsPanelModel,
	useSettingsPanelModel,
} from "./settings-panel";
import type { SettingsPanelProps } from "./settings-panel-model";

vi.mock("./api", async () => {
	const actual = await vi.importActual<typeof import("./api")>("./api");
	return {
		...actual,
		fetchLlmSettings: vi.fn(),
		fetchCodexStatus: vi.fn(),
		fetchRuntimeSettings: vi.fn(),
		updateLlmSettings: vi.fn(),
		updateRuntimeSettings: vi.fn(),
		updateSystemContext: vi.fn(),
		generateDastAuthEncryptionKey: vi.fn(),
		autoConfigureRuntimeIsolation: vi.fn(),
		checkLlmProviderHealth: vi.fn(),
	};
});

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const llmSettings: LlmSettingsResponse = {
	providerEndpoints: [
		{
			id: "local",
			name: "Local",
			kind: "openai-compatible",
			enabled: true,
			apiKey: "",
			baseUrl: "http://127.0.0.1:11434/v1",
			endpoint: "",
			apiVersion: "",
			region: "",
			models: ["qwen3"],
			modelDisplayNames: {},
			modelCapabilities: {},
		},
	],
	taskRoutes: [
		{
			task: "finding_review",
			primaryTarget: { providerEndpointId: "local", model: "qwen3" },
			fallbackTargets: [],
			policy: {},
		},
	],
	updatedAt: "2026-09-13T00:00:00.000Z",
};

const runtimeSettings = {
	scanExecutionMode: "docker",
	allowHostScannerExecution: false,
	scanDockerImage: "scanner:stable",
	dockerMemory: "2g",
	dockerCpus: 2,
	dockerPidsLimit: 512,
	scannerStdoutLimitBytes: 1,
	scannerStderrLimitBytes: 1,
	webProcessConcurrency: 2,
	webScanQueueLimit: 8,
	webScanStepTimeoutMaxSec: 60,
	webScanWallClockTimeoutSec: 120,
	codexSdkTimeoutMs: 1000,
	dastAuthEncryptionKey: "",
	dastAuthEncryptionKeyConfigured: false,
	dastAuthEncryptionKeySource: "none",
	updatedAt: null,
} as RuntimeSettingsResponse;

const props: SettingsPanelProps = {
	isAdmin: true,
	appHealth: { status: "ok", service: "api" },
	sourceHealth: { service: "wiki", git: null },
	systemContextText: "context",
	systemContextUpdatedAt: "2026-09-13T00:00:00.000Z",
	systemContextSaving: false,
	onSystemContextTextChange: vi.fn(),
	onSystemContextSaved: vi.fn(),
	onSystemContextSavingChange: vi.fn(),
	onDirtyChange: vi.fn(),
};

let latest: SettingsPanelModel | null = null;

function Harness(input: SettingsPanelProps) {
	latest = useSettingsPanelModel(input);
	return null;
}

async function render(input: SettingsPanelProps = props) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(<Harness {...input} />);
		await Promise.resolve();
		await Promise.resolve();
	});
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return root;
}

beforeEach(() => {
	vi.mocked(api.fetchLlmSettings).mockResolvedValue(llmSettings);
	vi.mocked(api.fetchCodexStatus).mockResolvedValue({
		authenticated: true,
		executableAdapterAvailable: true,
		detectedModels: ["gpt-5-codex"],
		authSource: "settings",
		modelSource: "settings",
		codexHome: "/tmp/codex",
	});
	vi.mocked(api.fetchRuntimeSettings).mockResolvedValue(runtimeSettings);
	vi.mocked(api.updateLlmSettings).mockImplementation(async (input) => ({
		...llmSettings,
		...input,
		updatedAt: "2026-09-13T01:00:00.000Z",
	}));
	vi.mocked(api.updateRuntimeSettings).mockResolvedValue(runtimeSettings);
	vi.mocked(api.updateSystemContext).mockResolvedValue({
		systemContext: "saved",
		updatedAt: "2026-09-13T01:00:00.000Z",
	});
	vi.mocked(api.generateDastAuthEncryptionKey).mockResolvedValue({
		...runtimeSettings,
		dastAuthEncryptionKeyConfigured: true,
		dastAuthEncryptionKeySource: "settings",
	});
	vi.mocked(api.autoConfigureRuntimeIsolation).mockResolvedValue(
		runtimeSettings,
	);
	vi.mocked(api.checkLlmProviderHealth).mockResolvedValue({
		ok: true,
		message: "ok",
	} as never);
	window.confirm = () => true;
});

afterEach(() => {
	document.body.replaceChildren();
	latest = null;
	vi.clearAllMocks();
});

describe("useSettingsPanelModel", () => {
	it("skips admin fetches for members", async () => {
		const root = await render({ ...props, isAdmin: false });
		expect(api.fetchLlmSettings).not.toHaveBeenCalled();
		expect(latest?.llmLoading).toBe(false);
		await act(async () => root.unmount());
	});

	it("loads settings and exercises save, health, and endpoint edits", async () => {
		const root = await render();
		expect(
			latest?.llmSettings?.providerEndpoints.some(
				(item) => item.id === "local",
			),
		).toBe(true);
		const before = latest?.llmSettings?.providerEndpoints.length ?? 0;
		await act(async () => {
			latest?.handleAddEndpoint();
		});
		expect(latest?.llmSettings?.providerEndpoints.length).toBe(before + 1);
		await act(async () => {
			latest?.updateEndpoint("local", { name: "Renamed" });
			latest?.updateRuntimeSetting({ dockerMemory: "4g" });
			latest?.updateRoute("finding_review", {
				fallbackTargets: [{ providerEndpointId: "local", model: "qwen3" }],
			});
			const route = latest?.llmSettings?.taskRoutes.find(
				(item) => item.task === "finding_review",
			);
			if (route) {
				latest?.addFallback(route);
				latest?.updateFallback(route, 0, {
					providerEndpointId: "local",
					model: "qwen3",
				});
				latest?.moveFallback(route, 0, 1);
			}
		});
		await act(async () => {
			await latest?.handleSaveSystemContext();
			await latest?.handleSaveRuntimeSettings();
			await latest?.handleGenerateDastAuthKey();
			await latest?.handleAutoConfigureRuntimeIsolation();
			await latest?.handleHealth("local");
			await latest?.refreshCodexStatus();
		});
		expect(api.updateSystemContext).toHaveBeenCalled();
		expect(api.updateRuntimeSettings).toHaveBeenCalled();
		await act(async () => {
			latest?.handleDeleteEndpoint("local");
		});
		expect(
			latest?.llmSettings?.providerEndpoints.some(
				(item) => item.id === "local",
			),
		).toBe(false);
		await act(async () => root.unmount());
	});

	it("records load and save failures", async () => {
		vi.mocked(api.fetchLlmSettings).mockRejectedValue(new Error("llm"));
		vi.mocked(api.fetchRuntimeSettings).mockRejectedValue("runtime");
		const root = await render();
		expect(latest?.llmError).toBe("llm");
		expect(latest?.runtimeError).toBe("Runtime設定を読み込めませんでした。");
		await act(async () => root.unmount());
	});
});
