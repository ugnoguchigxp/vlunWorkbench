import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../../app/env";
import { createDbConnection, type DbConnection } from "../../db";
import { LlmSettingsRepository } from "./llm-settings.repository";
import { SECRET_MASK } from "./secret-mask";

function migrate(connection: DbConnection): void {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of sqlFiles) {
		connection.sqlite.exec(
			readFileSync(path.resolve(migrationsDir, filename), "utf8"),
		);
	}
}

function appEnv(overrides: Partial<AppEnv> = {}): AppEnv {
	return {
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
		openAiCredentialSource: "none",
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
		...overrides,
	};
}

describe("LlmSettingsRepository", () => {
	let connection: DbConnection;

	beforeEach(() => {
		connection = createDbConnection(":memory:");
		migrate(connection);
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("seeds environment Azure settings without auto-owning task routes", async () => {
		const repo = new LlmSettingsRepository(
			connection.db,
			appEnv({
				azureOpenAiEndpoint: "https://example.openai.azure.com",
				azureOpenAiApiKey: "secret-key",
			}),
		);

		const settings = await repo.getSettings();

		expect(settings.providerEndpoints.map((endpoint) => endpoint.id)).toContain(
			"azure-env-default",
		);
		expect(settings.taskRoutes).toEqual([]);
		expect(
			settings.providerEndpoints.find(
				(endpoint) => endpoint.id === "azure-env-default",
			)?.apiKey,
		).toBe("");
	});

	it("preserves an existing stored secret when the request sends the mask", async () => {
		const repo = new LlmSettingsRepository(connection.db, appEnv());
		await repo.updateSettings({
			providerEndpoints: [
				{
					id: "openai-1",
					name: "OpenAI",
					kind: "openai",
					enabled: true,
					apiKey: "stored-secret",
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
						providerEndpointId: "openai-1",
						model: "gpt-4.1-mini",
					},
					fallbackTargets: [],
					policy: {},
				},
			],
		});

		const masked = await repo.getSettings({ maskSecrets: true, seedFromEnv: false });
		expect(masked.providerEndpoints[0].apiKey).toBe(SECRET_MASK);

		await repo.updateSettings({
			providerEndpoints: [
				{
					...masked.providerEndpoints[0],
					name: "OpenAI Updated",
				},
			],
			taskRoutes: masked.taskRoutes,
		});

		const raw = await repo.getSettings({ maskSecrets: false, seedFromEnv: false });
		expect(raw.providerEndpoints[0].apiKey).toBe("stored-secret");
		expect(raw.providerEndpoints[0].name).toBe("OpenAI Updated");
	});

	it("rejects unknown provider kinds and missing route models", async () => {
		const repo = new LlmSettingsRepository(connection.db, appEnv());

		await expect(
			repo.updateSettings({
				providerEndpoints: [
					{
						id: "bad",
						name: "Bad",
						kind: "bad" as "bedrock",
						enabled: true,
						apiKey: "",
						baseUrl: "",
						endpoint: "",
						apiVersion: "",
						region: "",
						models: ["x"],
						modelDisplayNames: {},
						modelCapabilities: {},
					},
				],
				taskRoutes: [],
			}),
		).rejects.toThrow();

		await expect(
			repo.updateSettings({
				providerEndpoints: [
					{
						id: "openai-1",
						name: "OpenAI",
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
							providerEndpointId: "openai-1",
							model: "not-configured",
						},
						fallbackTargets: [],
						policy: {},
					},
				],
			}),
		).rejects.toThrow("not configured");
	});

	it("persists a codex route for evidence context", async () => {
		const repo = new LlmSettingsRepository(connection.db, appEnv());

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

		const settings = await repo.getSettings({
			maskSecrets: false,
			seedFromEnv: false,
		});

		expect(settings.taskRoutes[0]).toMatchObject({
			task: "evidence_context",
			primaryTarget: {
				providerEndpointId: "codex-default",
				model: "gpt-5.4-mini",
			},
		});
	});
});
