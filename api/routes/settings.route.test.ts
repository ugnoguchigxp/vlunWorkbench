import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createSettingsRoute } from "./settings.route";

const userId = "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1";

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
});
