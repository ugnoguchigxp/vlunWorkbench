import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../db";
import type { AppEnv } from "../app/env";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
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
	port: 5173,
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
	azureOpenAiDeployment: "gpt-4.1",
	azureOpenAiEmbeddingsDeployment: "text-embedding-3-small",
	azureOpenAiApiVersion: "2024-10-21",
	jwtSecret: "x".repeat(32),
	jwtAccessExpiresIn: "15m",
	jwtRefreshExpiresIn: "7d",
	appUrl: "http://localhost:5173",
	corsOrigins: ["http://localhost:5173"],
	trustProxy: true,
	secureCookie: false,
	cookieSameSite: "lax",
	securityHeadersMode: "auto",
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

	it("resolves the environment seeded route", async () => {
		const repo = new LlmSettingsRepository(connection.db, env);
		const router = new LlmRouter(repo, env);

		const resolution = await router.resolve("finding_review");

		expect(resolution.ok).toBe(true);
		if (resolution.ok) {
			expect(resolution.target.providerEndpointId).toBe("openai-env-default");
			expect(resolution.model).toBe("gpt-4.1-mini");
		}
	});

	it("returns a typed unconfigured failure when no route can be selected", async () => {
		const repo = new LlmSettingsRepository(connection.db, {
			...env,
			openAiCredentialSource: "none",
			openAiApiKey: undefined,
		});
		const router = new LlmRouter(repo, env);

		const resolution = await router.resolve("finding_review");

		expect(resolution).toMatchObject({
			ok: false,
			failureKind: "llm_provider_unconfigured",
		});
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
