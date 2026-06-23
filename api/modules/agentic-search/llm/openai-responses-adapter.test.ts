import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiResponsesAdapter } from "./openai-responses-adapter";

describe("OpenAiResponsesAdapter", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("builds responses endpoint with api-version when provided", () => {
		const adapter = new OpenAiResponsesAdapter({
			apiKey: "test-key",
			baseUrl: "https://example.openai.azure.com/openai/v1",
			model: "my-deployment",
			apiVersion: "preview",
		});
		expect(adapter.getDiagnostics()).toMatchObject({
			baseUrl: "https://example.openai.azure.com/openai/v1",
			endpoint:
				"https://example.openai.azure.com/openai/v1/responses?api-version=preview",
			model: "my-deployment",
			apiVersion: "preview",
			provider: "azure",
		});
	});

	it("returns deployment hint for DeploymentNotFound", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							code: "DeploymentNotFound",
							message: "The API deployment for this resource does not exist.",
						},
					}),
					{
						status: 404,
						headers: { "x-ms-request-id": "req-123" },
					},
				),
			),
		);

		const adapter = new OpenAiResponsesAdapter({
			apiKey: "test-key",
			baseUrl: "https://example.openai.azure.com/openai/v1",
			model: "my-deployment",
		});

		let message = "";
		try {
			await adapter.createTurn({
				instructions: "test",
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: "hello" }],
					},
				],
				tools: [],
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toMatch(/DeploymentNotFound/);
		expect(message).toMatch(/Confirm AZURE_OPENAI_DEPLOYMENT/);
	});

	it("extracts assistant text from nested response output content", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						id: "resp_1",
						output: [
							{
								type: "message",
								role: "assistant",
								content: [
									{
										type: "output_text",
										text: "OK",
									},
								],
							},
						],
						usage: {
							input_tokens: 2,
							output_tokens: 1,
							total_tokens: 3,
						},
					}),
					{ status: 200 },
				),
			),
		);

		const adapter = new OpenAiResponsesAdapter({
			apiKey: "test-key",
			baseUrl: "https://example.openai.azure.com/openai/v1",
			model: "my-deployment",
		});

		const turn = await adapter.createTurn({
			instructions: "test",
			input: [
				{
					role: "user",
					content: [{ type: "input_text", text: "hello" }],
				},
			],
			tools: [],
		});

		expect(turn.text).toBe("OK");
		expect(turn.usage?.totalTokens).toBe(3);
	});
});
