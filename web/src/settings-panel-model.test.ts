import { describe, expect, it } from "vitest";
import type { LlmSettingsResponse } from "./api";
import {
	deriveProviderStatus,
	ensureCodexEndpoint,
	ensureRoutes,
	formatModelDisplayNames,
	parseModelDisplayNames,
	parseModels,
} from "./settings-panel-model";

describe("settings panel model", () => {
	it("normalizes model and display-label text deterministically", () => {
		expect(parseModels("gpt-5, qwen3-coder, gpt-5")).toEqual([
			"gpt-5",
			"qwen3-coder",
			"gpt-5",
		]);
		const labels = parseModelDisplayNames("gpt-5=Review\nqwen3=Local");
		expect(labels).toEqual({ "gpt-5": "Review", qwen3: "Local" });
		expect(formatModelDisplayNames(labels)).toBe(
			"gpt-5=Review\nqwen3=Local",
		);
	});

	it("fills every task route without overwriting configured routing", () => {
		const configured = {
			task: "finding_review" as const,
			primaryTarget: { providerEndpointId: "primary", model: "gpt-5" },
			fallbackTargets: [],
			policy: {},
		};
		const routes = ensureRoutes([configured]);
		expect(routes).toHaveLength(5);
		expect(routes[0]).toEqual(configured);
		expect(routes.map((route) => route.task)).toEqual([
			"finding_review",
			"scan_review",
			"evidence_context",
			"agentic_search",
			"report_summary",
		]);
	});

	it("adds one Codex endpoint and merges detected models", () => {
		const settings = {
			providerEndpoints: [],
			taskRoutes: [],
		} as unknown as LlmSettingsResponse;
		const normalized = ensureCodexEndpoint(settings, {
			authenticated: true,
			executableAdapterAvailable: true,
			detectedModels: ["gpt-5-codex"],
			authSource: "settings",
			modelSource: "settings",
			codexHome: "/tmp/codex",
		});
		expect(normalized.providerEndpoints).toHaveLength(1);
		expect(normalized.providerEndpoints[0]).toMatchObject({
			kind: "codex",
			enabled: true,
			models: ["gpt-5-codex"],
		});
	});

	it("derives a conservative provider status", () => {
		const endpoint = {
			id: "local",
			name: "Local",
			kind: "local" as const,
			enabled: true,
			baseUrl: "",
			models: ["qwen3"],
		} as LlmSettingsResponse["providerEndpoints"][number];
		expect(deriveProviderStatus(endpoint, null)).toMatchObject({
			label: "未設定",
		});
		expect(deriveProviderStatus({ ...endpoint, baseUrl: "http://localhost" }, null, { ok: true })).toMatchObject({ label: "接続済み" });
	});

	it("does not present an unavailable Codex status request as an authentication failure", () => {
		const endpoint = {
			id: "codex-default",
			name: "Codex SDK",
			kind: "codex" as const,
			enabled: true,
			models: ["gpt-5-codex"],
		} as LlmSettingsResponse["providerEndpoints"][number];
		expect(deriveProviderStatus(endpoint, null)).toMatchObject({
			label: "未確認",
		});
	});
});
