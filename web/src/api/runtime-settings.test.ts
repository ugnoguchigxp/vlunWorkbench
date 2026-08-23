import { describe, expect, it } from "vitest";
import type { RuntimeSettingsResponseInput } from "./runtime-settings";
import {
	normalizeRuntimeSettingsResponse,
	RUNTIME_ISOLATION_REQUIRED_SETTING_KEYS,
} from "./runtime-settings";

const legacySettings = (): RuntimeSettingsResponseInput => ({
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
});

describe("normalizeRuntimeSettingsResponse", () => {
	it("fills isolated runtime fields omitted by a legacy API response", () => {
		const normalized = normalizeRuntimeSettingsResponse(legacySettings());

		expect(normalized.runtimeIsolationConfigured).toBe(false);
		expect(normalized.runtimeIsolationMissingFields).toEqual(
			RUNTIME_ISOLATION_REQUIRED_SETTING_KEYS,
		);
		expect(normalized.runtimeIsolation.namespaceOwnerImage).toBe("");
		expect(normalized.runtimeIsolation.schemathesisImage).toBe("");
	});

	it("keeps the server's fail-closed state after normalizing required settings", () => {
		const digest = `sha256:${"a".repeat(64)}`;
		const normalized = normalizeRuntimeSettingsResponse({
			...legacySettings(),
			runtimeIsolation: {
				namespaceOwnerImage: `owner@${digest}`,
				nodeImage: `node@${digest}`,
				materializerImage: `materializer@${digest}`,
				registryProxyImage: `proxy@${digest}`,
				probeImage: `probe@${digest}`,
				httpExecutorImage: `executor@${digest}`,
				dockerDaemonIdentityHash: digest,
				qualificationHash: digest,
			},
			runtimeIsolationConfigured: false,
			runtimeIsolationMissingFields: ["stale"],
		});

		expect(normalized.runtimeIsolationConfigured).toBe(false);
		expect(normalized.runtimeIsolationMissingFields).toEqual(["stale"]);
	});

	it("preserves unknown runtime fields so an older UI does not erase them", () => {
		const input = {
			...legacySettings(),
			runtimeIsolation: {
				futureImage: "future@sha256:value",
			},
		} as RuntimeSettingsResponseInput;

		const normalized = normalizeRuntimeSettingsResponse(input);

		expect(
			(normalized.runtimeIsolation as unknown as Record<string, unknown>)
				.futureImage,
		).toBe("future@sha256:value");
	});
});
