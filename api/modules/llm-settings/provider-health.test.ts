import { describe, expect, it, vi } from "vitest";
import type { CodexStatus } from "./codex-status";
import type { LlmProviderEndpointSettings } from "./llm-settings.schema";
import { checkLlmProviderHealth } from "./provider-health";

function codexEndpoint(): LlmProviderEndpointSettings {
	return {
		id: "codex-test",
		name: "Codex Test",
		kind: "codex",
		enabled: true,
		apiKey: "",
		baseUrl: "",
		endpoint: "",
		apiVersion: "",
		region: "",
		models: ["test-codex-model"],
		modelDisplayNames: {},
		modelCapabilities: {},
	};
}

function codexStatus(
	patch: Partial<CodexStatus> = {},
): CodexStatus {
	return {
		authenticated: true,
		authSource: "settings",
		codexHome: "/tmp/codex-test",
		modelSource: "settings",
		detectedModels: ["test-codex-model"],
		executableAdapterAvailable: true,
		adapterDiagnostics: {
			packageName: "@openai/codex-sdk",
			runtimeMode: "bun-direct",
			sdkImportable: true,
			cliBinaryResolved: true,
			processLaunchVerified: false,
			liveConnectionVerified: false,
			message: "Local adapter is ready.",
		},
		...patch,
	};
}

describe("Codex provider health", () => {
	it("reports local readiness without claiming live reachability", async () => {
		const codexStatusReader = vi.fn(async () => codexStatus());

		const result = await checkLlmProviderHealth(codexEndpoint(), {
			apiKey: "resolved-key",
			codexStatusReader,
		});

		expect(result).toMatchObject({
			ok: true,
			reachable: false,
			status: "codex_local_ready",
			url: null,
		});
		expect(result.message).toContain(
			"Process launch and live connectivity are not verified",
		);
		expect(codexStatusReader).toHaveBeenCalledWith({
			settingsModels: ["test-codex-model"],
			codexApiKey: "resolved-key",
		});
	});

	it("distinguishes missing auth from local adapter failures", async () => {
		const authMissing = await checkLlmProviderHealth(codexEndpoint(), {
			codexStatusReader: async () =>
				codexStatus({ authenticated: false, authSource: "none" }),
		});
		expect(authMissing).toMatchObject({
			ok: false,
			reachable: false,
			status: "codex_auth_missing",
		});

		const binaryMissing = await checkLlmProviderHealth(codexEndpoint(), {
			codexStatusReader: async () => ({
				...codexStatus(),
				executableAdapterAvailable: false,
				adapterDiagnostics: {
					...codexStatus().adapterDiagnostics,
					cliBinaryResolved: false,
					message: "Codex CLI binary is unavailable.",
				},
			}),
		});
		expect(binaryMissing).toMatchObject({
			ok: false,
			reachable: false,
			status: "codex_binary_unavailable",
			message: "Codex CLI binary is unavailable.",
		});
	});
});
