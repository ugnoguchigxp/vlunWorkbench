import { describe, expect, it, vi } from "vitest";
import { AzureOpenAiProvider } from "./AzureOpenAiProvider";

const chatBody = {
	id: "chat-1",
	choices: [{ message: { role: "assistant" as const, content: "hello" } }],
	usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
};

const jsonResponse = (status: number, body: unknown, statusText = "OK") =>
	new Response(JSON.stringify(body), {
		status,
		statusText,
		headers: { "content-type": "application/json" },
	});

describe("AzureOpenAiProvider", () => {
	it("requires endpoint and API key from the environment", () => {
		expect(() =>
			AzureOpenAiProvider.fromEnv({
				AZURE_OPENAI_ENDPOINT: "",
				AZURE_OPENAI_API_KEY: "key",
			}),
		).toThrow("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required");
	});

	it("completes chat and embeddings through fetchImpl", async () => {
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("/embeddings")) {
				return jsonResponse(200, { data: [{ embedding: [0.1, 0.2] }] });
			}
			return jsonResponse(200, chatBody);
		});
		const provider = new AzureOpenAiProvider({
			endpoint: "https://example.openai.azure.com/",
			apiKey: "key",
			deployment: "gpt-4o-mini",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			provider.chatCompletion([{ role: "user", content: "hi" }], {
				temperature: 0,
				maxTokens: 16,
			}),
		).resolves.toMatchObject({
			id: "chat-1",
			content: "hello",
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
		});
		await expect(provider.createEmbedding("hello")).resolves.toEqual([
			0.1, 0.2,
		]);
	});

	it("retries retryable HTTP failures and surfaces terminal errors", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(429, {}, "Too Many Requests"))
			.mockResolvedValueOnce(jsonResponse(200, chatBody))
			.mockResolvedValueOnce(jsonResponse(400, {}, "Bad Request"))
			.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
		const provider = new AzureOpenAiProvider({
			endpoint: "https://example.openai.azure.com",
			apiKey: "key",
			deployment: "gpt-4o-mini",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			provider.chatCompletion([{ role: "user", content: "retry" }]),
		).resolves.toMatchObject({ content: "hello" });
		await expect(
			provider.chatCompletion([{ role: "user", content: "fail" }]),
		).rejects.toThrow("Azure OpenAI error (400)");
		await expect(provider.createEmbedding("missing")).rejects.toThrow(
			"Embedding response missing data.",
		);
	});

	it("retries thrown fetch errors then succeeds", async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValueOnce(new Error("reset"))
			.mockResolvedValueOnce(jsonResponse(200, chatBody));
		const provider = new AzureOpenAiProvider({
			endpoint: "https://example.openai.azure.com",
			apiKey: "key",
			deployment: "gpt-4o-mini",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			provider.chatCompletion([{ role: "user", content: "again" }]),
		).resolves.toMatchObject({ content: "hello" });
		expect(
			AzureOpenAiProvider.fromEnv({
				AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
				AZURE_OPENAI_API_KEY: "key",
				NODE_ENV: "test",
			}),
		).toBeDefined();
	});
});
