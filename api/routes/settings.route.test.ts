import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { readAppEnv } from "../app/env";
import {
	RUNTIME_SETTINGS_DEFAULTS,
	runtimeSettingsFromAppEnv,
} from "../config/runtime-settings";
import { RuntimeIsolationAutoConfigError } from "../modules/runtime-isolation/runtime-isolation-auto-config";
import { createSettingsRoute } from "./settings.route";

const userId = "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1";
const digest = `sha256:${"a".repeat(64)}`;

const completeRuntimeIsolation = {
	...RUNTIME_SETTINGS_DEFAULTS.runtimeIsolation,
	namespaceOwnerImage: `vuln-workbench-runtime@${digest}`,
	nodeImage: `vuln-workbench-runtime@${digest}`,
	materializerImage: `vuln-workbench-runtime@${digest}`,
	registryProxyImage: `vuln-workbench-runtime@${digest}`,
	probeImage: `vuln-workbench-runtime@${digest}`,
	httpExecutorImage: `vuln-workbench-runtime@${digest}`,
	dockerDaemonIdentityHash: digest,
	qualificationHash: digest,
};

function runtimeResponse() {
	const settings = runtimeSettingsFromAppEnv(readAppEnv({ NODE_ENV: "test" }));
	const {
		dastAuthEncryptionKey: _key,
		dastAuthPreviousEncryptionKeys: _previousKeys,
		...base
	} = settings;
	return {
		...base,
		dastAuthEncryptionKey: "" as const,
		dastAuthEncryptionKeyConfigured: false,
		dastAuthEncryptionKeySource: "none" as const,
		runtimeIsolationConfigured: false,
		runtimeIsolationMissingFields: [
			"namespaceOwnerImage",
			"nodeImage",
			"materializerImage",
			"registryProxyImage",
			"probeImage",
			"httpExecutorImage",
			"dockerDaemonIdentityHash",
			"qualificationHash",
		],
		updatedAt: null,
	};
}

const createApp = (role: "admin" | "member") => {
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("authUser", { userId, email: `${role}@example.com`, role });
		await next();
	});
	app.route(
		"/settings",
		createSettingsRoute({
			settingsRepository: {
				getSystemContextForUser: vi.fn().mockResolvedValue({
					systemContext: "member-owned context",
					updatedAt: new Date("2026-01-01T00:00:00.000Z"),
				}),
				getRuntimeSettings: vi.fn().mockResolvedValue({
					scanExecutionMode: "host",
					allowHostScannerExecution: true,
					scanDockerImage: "vuln-workbench-toolbox:local",
					dockerMemory: "4g",
					dockerCpus: 2,
					dockerPidsLimit: 512,
					scannerStdoutLimitBytes: 64 * 1024 * 1024,
					scannerStderrLimitBytes: 8 * 1024 * 1024,
					codexSdkTimeoutMs: 600_000,
					dastAuthEncryptionKey: "",
					dastAuthEncryptionKeyConfigured: false,
					dastAuthEncryptionKeySource: "none",
					updatedAt: null,
				}),
			} as never,
			llmSettingsRepository: {
				getSettings: vi.fn().mockResolvedValue({
					providerEndpoints: [],
					taskRoutes: [],
					updatedAt: null,
				}),
			} as never,
		}),
	);
	app.onError((error, c) =>
		c.json(
			{ message: error.message },
			("status" in error ? error.status : 500) as 403 | 500,
		),
	);
	return app;
};

describe("Settings route authorization", () => {
	it("keeps user-scoped system context available to members", async () => {
		const response = await createApp("member").request(
			"/settings/system-context",
		);
		expect(response.status).toBe(200);
	});

	it("denies global LLM settings to members", async () => {
		const response = await createApp("member").request("/settings/llm");
		expect(response.status).toBe(403);
	});

	it("allows administrators to read global LLM settings", async () => {
		const response = await createApp("admin").request("/settings/llm");
		expect(response.status).toBe(200);
	});

	it("denies global runtime settings to members", async () => {
		const response = await createApp("member").request("/settings/runtime");
		expect(response.status).toBe(403);
	});

	it("denies DAST key generation to members", async () => {
		const response = await createApp("member").request(
			"/settings/runtime/dast-auth-key/generate",
			{ method: "POST" },
		);
		expect(response.status).toBe(403);
	});

	it("denies isolated runtime auto-configuration to members", async () => {
		const response = await createApp("member").request(
			"/settings/runtime/isolation/auto-configure",
			{ method: "POST" },
		);
		expect(response.status).toBe(403);
	});

	it("allows administrators to read runtime settings", async () => {
		const response = await createApp("admin").request("/settings/runtime");
		expect(response.status).toBe(200);
	});

	it("generates a 32-byte DAST auth key without returning it", async () => {
		const updateRuntimeSettings = vi.fn().mockResolvedValue({
			scanExecutionMode: "host",
			allowHostScannerExecution: true,
			scanDockerImage: "vuln-workbench-toolbox:local",
			dockerMemory: "4g",
			dockerCpus: 2,
			dockerPidsLimit: 512,
			scannerStdoutLimitBytes: 64 * 1024 * 1024,
			scannerStderrLimitBytes: 8 * 1024 * 1024,
			codexSdkTimeoutMs: 600_000,
			dastAuthEncryptionKey: "",
			dastAuthEncryptionKeyConfigured: true,
			dastAuthEncryptionKeySource: "settings",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const settingsRepository = { updateRuntimeSettings };
		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", { userId, email: "admin@example.com", role: "admin" });
			await next();
		});
		app.route(
			"/settings",
			createSettingsRoute({ settingsRepository } as never),
		);

		const response = await app.request(
			"/settings/runtime/dast-auth-key/generate",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					scanExecutionMode: "host",
					allowHostScannerExecution: true,
					scanDockerImage: "vuln-workbench-toolbox:local",
					dockerMemory: "4g",
					dockerCpus: 2,
					dockerPidsLimit: 512,
					scannerStdoutLimitBytes: 64 * 1024 * 1024,
					scannerStderrLimitBytes: 8 * 1024 * 1024,
					codexSdkTimeoutMs: 600_000,
					dastAuthEncryptionKey: "",
				}),
			},
		);
		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain("dastAuthPreviousEncryptionKeys");
		const generatedKey = updateRuntimeSettings.mock.calls[0]?.[0]
			.dastAuthEncryptionKey;
		expect(Buffer.from(generatedKey, "base64")).toHaveLength(32);
	});

	it("applies saved settings to the shared runtime before notifying consumers", async () => {
		const runtimeEnv = readAppEnv({ NODE_ENV: "test" });
		const resolvedEnv = { ...runtimeEnv, dockerMemory: "3g" };
		const updateRuntimeSettings = vi.fn().mockResolvedValue({ updatedAt: null });
		const resolveAppEnv = vi.fn().mockResolvedValue(resolvedEnv);
		const onRuntimeSettingsUpdated = vi.fn();
		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", { userId, email: "admin@example.com", role: "admin" });
			await next();
		});
		app.route(
			"/settings",
			createSettingsRoute({
				settingsRepository: {
					updateRuntimeSettings,
					resolveAppEnv,
				} as never,
				runtimeEnv,
				onRuntimeSettingsUpdated,
			}),
		);

		const response = await app.request("/settings/runtime", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				scanExecutionMode: "host",
				allowHostScannerExecution: true,
				scanDockerImage: "vuln-workbench-toolbox:local",
				dockerMemory: "3g",
				dockerCpus: 2,
				dockerPidsLimit: 512,
				scannerStdoutLimitBytes: 64 * 1024 * 1024,
				scannerStderrLimitBytes: 8 * 1024 * 1024,
				codexSdkTimeoutMs: 600_000,
			}),
		});

		expect(response.status).toBe(200);
		expect(runtimeEnv.dockerMemory).toBe("3g");
		expect(onRuntimeSettingsUpdated).toHaveBeenCalledOnce();
		expect(onRuntimeSettingsUpdated).toHaveBeenCalledWith(runtimeEnv);
	});

	it("qualifies and saves all isolated runtime settings in one update", async () => {
		const runtimeEnv = readAppEnv({ NODE_ENV: "test" });
		const optionalPostgresImage = `postgres@${digest}`;
		const initial = runtimeResponse();
		const current = {
			...initial,
			runtimeIsolation: {
				...initial.runtimeIsolation,
				postgresImage: optionalPostgresImage,
			},
		};
		const expectedRuntimeIsolation = {
			...completeRuntimeIsolation,
			postgresImage: optionalPostgresImage,
		};
		const updated = {
			...current,
			runtimeIsolation: expectedRuntimeIsolation,
			runtimeIsolationConfigured: true,
			runtimeIsolationMissingFields: [],
		};
		const updateRuntimeSettings = vi.fn().mockResolvedValue(updated);
		const resolveAppEnv = vi
			.fn()
			.mockResolvedValue({
				...runtimeEnv,
				runtimeIsolation: expectedRuntimeIsolation,
			});
		const autoConfigureRuntimeIsolation = vi
			.fn()
			.mockResolvedValue(completeRuntimeIsolation);
		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", {
				userId,
				email: "admin@example.com",
				role: "admin",
			});
			await next();
		});
		app.route(
			"/settings",
			createSettingsRoute({
				settingsRepository: {
					getRuntimeSettings: vi.fn().mockResolvedValue(current),
					updateRuntimeSettings,
					resolveAppEnv,
				} as never,
				runtimeEnv,
				autoConfigureRuntimeIsolation,
			}),
		);

		const response = await app.request(
			"/settings/runtime/isolation/auto-configure",
			{ method: "POST" },
		);

		expect(response.status).toBe(200);
		expect(autoConfigureRuntimeIsolation).toHaveBeenCalledOnce();
		expect(updateRuntimeSettings).toHaveBeenCalledWith(
			expect.objectContaining({ runtimeIsolation: expectedRuntimeIsolation }),
			runtimeEnv,
		);
		expect(updateRuntimeSettings.mock.calls[0]?.[0]).not.toHaveProperty(
			"runtimeIsolationMissingFields",
		);
	});

	it("does not save partial settings when runtime qualification fails", async () => {
		const updateRuntimeSettings = vi.fn();
		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", {
				userId,
				email: "admin@example.com",
				role: "admin",
			});
			await next();
		});
		app.route(
			"/settings",
			createSettingsRoute({
				settingsRepository: { updateRuntimeSettings } as never,
				autoConfigureRuntimeIsolation: vi.fn().mockRejectedValue(
					new RuntimeIsolationAutoConfigError(
						"runtime_isolation_image_build_failed",
						"The local isolated runtime image could not be built.",
					),
				),
			}),
		);

		const response = await app.request(
			"/settings/runtime/isolation/auto-configure",
			{ method: "POST" },
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			code: "runtime_isolation_image_build_failed",
		});
		expect(updateRuntimeSettings).not.toHaveBeenCalled();
	});
});
