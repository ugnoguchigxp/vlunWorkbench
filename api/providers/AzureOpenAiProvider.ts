import { z } from "zod";

import { APP_CONFIG_DEFAULTS } from "../config/appDefaults";
import {
	fetchWithOutboundPolicy,
	type OutboundUrlPolicy,
} from "../security/outbound-url-policy";
import { AzureChatResponseSchema, type ChatMessage } from "../types/llm";

import type {
	EmbeddingProvider,
	LlmCompletionOptions,
	LlmProvider,
	LlmResponse,
} from "./types";

export interface AzureOpenAiConfig {
	endpoint: string;
	apiKey: string;
	deployment: string;
	embeddingsDeployment?: string;
	apiVersion?: string;
	fetchImpl?: typeof fetch;
	outboundPolicy?: OutboundUrlPolicy;
}

/**
 * Azure OpenAI の LlmProvider + EmbeddingProvider 実装
 */
export class AzureOpenAiProvider implements LlmProvider, EmbeddingProvider {
	private static readonly REQUEST_TIMEOUT_MS = 30_000;
	private static readonly MAX_RETRIES = 2;
	private readonly endpoint: string;
	private readonly apiKey: string;
	private readonly deployment: string;
	private readonly embeddingsDeployment: string;
	private readonly apiVersion: string;
	private readonly fetchImpl?: typeof fetch;
	private readonly outboundPolicy?: OutboundUrlPolicy;

	constructor(config: AzureOpenAiConfig) {
		this.endpoint = config.endpoint.replace(/\/+$/, "");
		this.apiKey = config.apiKey;
		this.deployment = config.deployment;
		this.embeddingsDeployment =
			config.embeddingsDeployment ?? config.deployment;
		this.apiVersion =
			config.apiVersion ?? APP_CONFIG_DEFAULTS.azureOpenAiApiVersion;
		this.fetchImpl = config.fetchImpl;
		this.outboundPolicy = config.outboundPolicy;
	}

	/**
	 * 環境変数から AzureOpenAiProvider を生成するヘルパー
	 */
	static fromEnv(env: NodeJS.ProcessEnv = process.env): AzureOpenAiProvider {
		const endpoint = env.AZURE_OPENAI_ENDPOINT;
		const apiKey = env.AZURE_OPENAI_API_KEY;
		const deployment =
			env.AZURE_OPENAI_DEPLOYMENT?.trim() ||
			APP_CONFIG_DEFAULTS.azureOpenAiDeployment;

		if (!endpoint || !apiKey) {
			throw new Error(
				"AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required",
			);
		}

		return new AzureOpenAiProvider({
			endpoint,
			apiKey,
			deployment,
			embeddingsDeployment:
				env.AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT ||
				APP_CONFIG_DEFAULTS.azureOpenAiEmbeddingsDeployment,
			apiVersion: APP_CONFIG_DEFAULTS.azureOpenAiApiVersion,
			outboundPolicy: {
				kind: "azure",
				nodeEnv:
					env.NODE_ENV === "development" || env.NODE_ENV === "test"
						? env.NODE_ENV
						: "production",
				allowedHosts: [new URL(endpoint).hostname],
			},
		});
	}

	async chatCompletion(
		messages: ChatMessage[],
		options?: LlmCompletionOptions,
	): Promise<LlmResponse> {
		const url = `${this.endpoint}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;

		const body: Record<string, unknown> = { messages };
		if (options?.temperature !== undefined)
			body.temperature = options.temperature;
		if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

		const response = await this.fetchWithRetry(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"api-key": this.apiKey,
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(
				`Azure OpenAI error (${response.status}): ${response.statusText || "request failed"}`,
			);
		}

		const data = AzureChatResponseSchema.parse(await response.json());
		const choice = data.choices[0];

		return {
			id: data.id,
			content: choice?.message?.content ?? "",
			usage: data.usage
				? {
						promptTokens: data.usage.prompt_tokens,
						completionTokens: data.usage.completion_tokens,
						totalTokens: data.usage.total_tokens,
					}
				: undefined,
		};
	}

	async createEmbedding(input: string): Promise<number[]> {
		const url = `${this.endpoint}/openai/deployments/${this.embeddingsDeployment}/embeddings?api-version=${this.apiVersion}`;

		const response = await this.fetchWithRetry(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"api-key": this.apiKey,
			},
			body: JSON.stringify({ input }),
		});

		if (!response.ok) {
			throw new Error(
				`Azure OpenAI Embedding error (${response.status}): ${response.statusText || "request failed"}`,
			);
		}

		const schema = z.object({
			data: z.array(
				z.object({
					embedding: z.array(z.number()),
				}),
			),
		});

		const payload = schema.parse(await response.json());
		const embedding = payload.data[0]?.embedding;
		if (!embedding) throw new Error("Embedding response missing data.");
		return embedding;
	}

	private async fetchWithRetry(
		url: string,
		init: RequestInit,
	): Promise<Response> {
		let lastError: unknown;

		for (
			let attempt = 0;
			attempt <= AzureOpenAiProvider.MAX_RETRIES;
			attempt++
		) {
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(),
				AzureOpenAiProvider.REQUEST_TIMEOUT_MS,
			);

			try {
				const requestInit = { ...init, signal: controller.signal };
				const response = this.outboundPolicy
					? await fetchWithOutboundPolicy({
							url,
							init: requestInit,
							policy: this.outboundPolicy,
							fetchImpl: this.fetchImpl,
						})
					: await (this.fetchImpl ?? fetch)(url, requestInit);

				if (response.ok) {
					clearTimeout(timeout);
					return response;
				}

				if (
					attempt < AzureOpenAiProvider.MAX_RETRIES &&
					this.shouldRetry(response.status)
				) {
					clearTimeout(timeout);
					await this.sleep(this.backoffMs(attempt));
					continue;
				}

				clearTimeout(timeout);
				return response;
			} catch (error) {
				clearTimeout(timeout);
				lastError = error;
				if (attempt >= AzureOpenAiProvider.MAX_RETRIES) {
					throw error;
				}
				await this.sleep(this.backoffMs(attempt));
			}
		}

		throw lastError instanceof Error ? lastError : new Error("Request failed");
	}

	private shouldRetry(status: number): boolean {
		return status === 408 || status === 429 || status >= 500;
	}

	private backoffMs(attempt: number): number {
		return 300 * (attempt + 1) * (attempt + 1);
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
