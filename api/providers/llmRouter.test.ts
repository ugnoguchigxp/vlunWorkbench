import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../app/env";
import { createDbConnection, type DbConnection } from "../db";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { CodexSdkProvider } from "./codexSdkProvider";
import { LlmRouter } from "./llmRouter";
import { OpenAiCompatibleProvider } from "./openAiCompatibleProvider";

function migrate(connection: DbConnection): void {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b))) {
		connection.sqlite.exec(
			readFileSync(path.resolve(migrationsDir, filename), "utf8"),
		);
	}
}

const env = {
	nodeEnv: "test",
	host: "127.0.0.1",
	port: 29831,
	databaseUrl: ":memory:",
	contentRoot: "/tmp/content",
	wikiStorageBackend: "local",
	wikiBlobContainer: "wiki",
	wikiBlobPrefix: "",
	wikiBlobPullIntervalMs: 60_000,
	webSearchProviderMode: "auto",
	exaSearchBaseUrl: "https://api.exa.ai",
	openAiCredentialSource: "openai",
	openAiApiKey: "env-key",
	openAiAgenticSearchModel: "gpt-4.1-mini",
	openAiAgenticSearchDebug: false,
	openAiAgenticSearchMaxToolCalls: 4,
	openAiAgenticSearchMaxFetchCalls: 4,
	openAiAgenticSearchMaxContextChars: 12_000,
	codexSdkTimeoutMs: 600_000,
	azureOpenAiDeployment: "gpt-4.1",
	azureOpenAiEmbeddingsDeployment: "text-embedding-3-small",
	azureOpenAiApiVersion: "2024-10-21",
	jwtSecret: "x".repeat(32),
	jwtAccessExpiresIn: "15m",
	jwtRefreshExpiresIn: "7d",
	appUrl: "http://localhost:29831",
	corsOrigins: ["http://localhost:29831"],
	trustProxy: true,
	secureCookie: false,
	cookieSameSite: "lax",
	securityHeadersMode: "auto",
	nightworkersIntegrationEnabled: false,
	nightworkersIntegrationAutoCreateProjects: false,
	nightworkersIntegrationAllowedProfiles: [],
	nightworkersIntegrationPreviewTtlSeconds: 300,
	nightworkersIntegrationIdempotencyTtlHours: 168,
	nightworkersIntegrationMaxConcurrentScans: 2,
	nightworkersIntegrationMaxFindingPageSize: 100,
	nightworkersIntegrationMaxEventPageSize: 200,
	nightworkersIntegrationMaxReportBytes: 5 * 1024 * 1024,
	nightworkersIntegrationMaxRequestBytes: 64 * 1024,
	nightworkersReportRunnerConcurrency: 2,
} satisfies AppEnv;

describe("LlmRouter", () => {
	let connection: DbConnection;

	beforeEach(() => {
		connection = createDbConnection(":memory:");
		migrate(connection);
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("does not resolve an environment provider when the task route is missing", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		const router = new LlmRouter(repo, env);

		const resolution = await router.resolve("finding_review");

		expect(resolution).toMatchObject({
			ok: false,
			failureKind: "llm_route_missing",
		});
	});

	it("resolves an explicit primary target", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		await repo.updateSettings({
			providerEndpoints: [
				{
					id: "openai-explicit",
					name: "OpenAI Explicit",
					kind: "openai",
					enabled: true,
					apiKey: "",
					baseUrl: "https://api.openai.com/v1",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-4.1-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
			],
			taskRoutes: [
				{
					task: "finding_review",
					primaryTarget: {
						providerEndpointId: "openai-explicit",
						model: "gpt-4.1-mini",
					},
					fallbackTargets: [],
					policy: {},
				},
			],
		});

		const router = new LlmRouter(repo, env);
		const resolution = await router.resolve("finding_review");

		expect(resolution.ok).toBe(true);
		if (resolution.ok) {
			expect(resolution.target.providerEndpointId).toBe("openai-explicit");
			expect(resolution.model).toBe("gpt-4.1-mini");
		}
	});

	it("uses an explicit route override when provider and model are supplied", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		await repo.updateSettings({
			providerEndpoints: [
				{
					id: "codex-default",
					name: "Codex SDK",
					kind: "codex",
					enabled: true,
					apiKey: "",
					baseUrl: "",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-5.4-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
				{
					id: "openai-override",
					name: "OpenAI Override",
					kind: "openai",
					enabled: true,
					apiKey: "",
					baseUrl: "https://api.openai.com/v1",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-4.1-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
			],
			taskRoutes: [
				{
					task: "finding_review",
					primaryTarget: {
						providerEndpointId: "codex-default",
						model: "gpt-5.4-mini",
					},
					fallbackTargets: [],
					policy: {},
				},
			],
		});

		const router = new LlmRouter(repo, env);
		const resolution = await router.resolve("finding_review", {
			providerEndpointId: "openai-override",
			model: "gpt-4.1-mini",
		});

		expect(resolution.ok).toBe(true);
		if (resolution.ok) {
			expect(resolution.target.providerEndpointId).toBe("openai-override");
			expect(resolution.model).toBe("gpt-4.1-mini");
			expect(resolution.provider).toBeInstanceOf(OpenAiCompatibleProvider);
		}
	});

	it("can resolve a fully specified override without a stored route", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		await repo.updateSettings({
			providerEndpoints: [
				{
					id: "codex-default",
					name: "Codex SDK",
					kind: "codex",
					enabled: true,
					apiKey: "",
					baseUrl: "",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-5.4-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
			],
			taskRoutes: [],
		});

		const router = new LlmRouter(repo, env);
		const resolution = await router.resolve("scan_review", {
			providerEndpointId: "codex-default",
			model: "gpt-5.4-mini",
		});

		expect(resolution.ok).toBe(true);
		if (resolution.ok) {
			expect(resolution.target.providerEndpointId).toBe("codex-default");
			expect(resolution.provider).toBeInstanceOf(CodexSdkProvider);
		}
	});

	it("does not use a fallback target when fallback policy is disabled", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		await repo.updateSettings({
			providerEndpoints: [
				{
					id: "codex-default",
					name: "Codex SDK",
					kind: "codex",
					enabled: true,
					apiKey: "",
					baseUrl: "",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-5.4-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
				{
					id: "openai-fallback",
					name: "OpenAI fallback",
					kind: "openai",
					enabled: true,
					apiKey: "",
					baseUrl: "https://api.openai.com/v1",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-4.1-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
			],
			taskRoutes: [
				{
					task: "finding_review",
					primaryTarget: {
						providerEndpointId: "codex-default",
						model: "gpt-5.4-mini",
					},
					fallbackTargets: [
						{
							providerEndpointId: "openai-fallback",
							model: "gpt-4.1-mini",
						},
					],
					policy: {},
				},
			],
		});
		const router = new LlmRouter(repo, env);

		const resolution = await router.resolve("finding_review");

		expect(resolution.ok).toBe(true);
		if (resolution.ok) {
			expect(resolution.target.providerEndpointId).toBe("codex-default");
			expect(resolution.model).toBe("gpt-5.4-mini");
			expect(resolution.provider).toBeInstanceOf(CodexSdkProvider);
		}
	});

	it("resolves codex routes to the Codex SDK provider", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		await repo.updateSettings({
			providerEndpoints: [
				{
					id: "codex-default",
					name: "Codex SDK",
					kind: "codex",
					enabled: true,
					apiKey: "",
					baseUrl: "",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-5.4-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
			],
			taskRoutes: [
				{
					task: "scan_review",
					primaryTarget: {
						providerEndpointId: "codex-default",
						model: "gpt-5.4-mini",
					},
					fallbackTargets: [],
					policy: {},
				},
			],
		});
		const router = new LlmRouter(repo, env);

		const resolution = await router.resolve("scan_review");

		expect(resolution.ok).toBe(true);
		if (resolution.ok) {
			expect(resolution.providerName).toBe("codex:codex-default");
			expect(resolution.target.thinkingDepth).toBe("low");
			expect(resolution.provider).toBeInstanceOf(CodexSdkProvider);
			expect(
				(resolution.provider as CodexSdkProvider).getDiagnostics(),
			).toMatchObject({
				timeoutMs: 600_000,
				reasoningEffort: "low",
			});
		}
	});

	it("rejects codex routes when route policy disables codex", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		await repo.updateSettings({
			providerEndpoints: [
				{
					id: "codex-default",
					name: "Codex SDK",
					kind: "codex",
					enabled: true,
					apiKey: "",
					baseUrl: "",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-5.4-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
			],
			taskRoutes: [
				{
					task: "finding_review",
					primaryTarget: {
						providerEndpointId: "codex-default",
						model: "gpt-5.4-mini",
					},
					fallbackTargets: [],
					policy: { allowCodex: false },
				},
			],
		});
		const router = new LlmRouter(repo, env);

		const resolution = await router.resolve("finding_review");

		expect(resolution).toMatchObject({
			ok: false,
			failureKind: "llm_provider_kind_not_allowed",
		});
	});

	it("resolves codex endpoints for evidence context routes", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		await repo.updateSettings({
			providerEndpoints: [
				{
					id: "codex-default",
					name: "Codex SDK",
					kind: "codex",
					enabled: true,
					apiKey: "",
					baseUrl: "",
					endpoint: "",
					apiVersion: "",
					region: "",
					models: ["gpt-5.4-mini"],
					modelDisplayNames: {},
					modelCapabilities: {},
				},
			],
			taskRoutes: [
				{
					task: "evidence_context",
					primaryTarget: {
						providerEndpointId: "codex-default",
						model: "gpt-5.4-mini",
					},
					fallbackTargets: [],
					policy: {},
				},
			],
		});
		const router = new LlmRouter(repo, env);

		const resolution = await router.resolve("evidence_context");

		expect(resolution.ok).toBe(true);
		if (resolution.ok) {
			expect(resolution.providerName).toBe("codex:codex-default");
			expect(resolution.provider).toBeInstanceOf(CodexSdkProvider);
		}
	});
});

describe("OpenAiCompatibleProvider", () => {
	it("constructs a chat completions request with model and bearer auth", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "chatcmpl-1",
					choices: [{ message: { content: "ok" } }],
				}),
				{ status: 200 },
			),
		);
		const provider = new OpenAiCompatibleProvider({
			baseUrl: "https://api.example.test/v1/",
			apiKey: "secret",
			model: "model-a",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const response = await provider.chatCompletion([
			{ role: "user", content: "hello" },
		]);

		expect(response.content).toBe("ok");
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://api.example.test/v1/chat/completions",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer secret",
				}),
				body: expect.stringContaining('"model":"model-a"'),
			}),
		);
	});
});
