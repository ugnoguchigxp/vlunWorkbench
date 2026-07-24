import { z } from "zod";
import type { ChatMessage } from "../types/llm";
import {
	fetchWithOutboundPolicy,
	type OutboundUrlPolicy,
} from "../security/outbound-url-policy";
import type { LlmCompletionOptions, LlmProvider, LlmResponse } from "./types";

export type OpenAiCompatibleProviderConfig = {
	baseUrl?: string;
	apiKey?: string;
	model: string;
	apiVersion?: string;
	fetchImpl?: typeof fetch;
	outboundPolicy?: OutboundUrlPolicy;
};

const ChatCompletionResponseSchema = z.object({
	id: z.string().optional(),
	choices: z.array(
		z.object({
			message: z.object({
				content: z.string().nullable().optional(),
			}),
		}),
	),
	usage: z
		.object({
			prompt_tokens: z.number().optional(),
			completion_tokens: z.number().optional(),
			total_tokens: z.number().optional(),
		})
		.optional(),
});

function normalizeBaseUrl(baseUrl?: string): string {
	const raw = baseUrl?.trim() || "https://api.openai.com/v1";
	return raw.replace(/\/+$/, "");
}

export class OpenAiCompatibleProvider implements LlmProvider {
	private readonly baseUrl: string;
	private readonly apiKey?: string;
	private readonly model: string;
	private readonly apiVersion?: string;
	private readonly fetchImpl?: typeof fetch;
	private readonly outboundPolicy?: OutboundUrlPolicy;

	constructor(config: OpenAiCompatibleProviderConfig) {
		this.baseUrl = normalizeBaseUrl(config.baseUrl);
		this.apiKey = config.apiKey?.trim() || undefined;
		this.model = config.model.trim();
		this.apiVersion = config.apiVersion?.trim() || undefined;
		this.fetchImpl = config.fetchImpl;
		this.outboundPolicy = config.outboundPolicy;
	}

	getDiagnostics(): { endpoint: string; model: string; hasApiKey: boolean } {
		return {
			endpoint: this.buildUrl("chat/completions"),
			model: this.model,
			hasApiKey: Boolean(this.apiKey),
		};
	}

	async chatCompletion(
		messages: ChatMessage[],
		options?: LlmCompletionOptions,
	): Promise<LlmResponse> {
		const body: Record<string, unknown> = {
			model: this.model,
			messages,
		};
		if (options?.temperature !== undefined) {
			body.temperature = options.temperature;
		}
		if (options?.maxTokens !== undefined) {
			body.max_tokens = options.maxTokens;
		}

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.apiKey) {
			headers.Authorization = `Bearer ${this.apiKey}`;
		}

		const requestUrl = this.buildUrl("chat/completions");
		const requestInit = {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		};
		const response = this.outboundPolicy
			? await fetchWithOutboundPolicy({
					url: requestUrl,
					init: requestInit,
					policy: this.outboundPolicy,
					fetchImpl: this.fetchImpl,
				})
			: await (this.fetchImpl ?? fetch)(requestUrl, requestInit);
		if (!response.ok) {
			throw new Error(
				`OpenAI-compatible provider error (${response.status}): ${response.statusText || "request failed"}`,
			);
		}

		const payload = ChatCompletionResponseSchema.parse(await response.json());
		const usage = payload.usage;
		return {
			id: payload.id ?? crypto.randomUUID(),
			content: payload.choices[0]?.message.content ?? "",
			usage: usage
				? {
						promptTokens: usage.prompt_tokens ?? 0,
						completionTokens: usage.completion_tokens ?? 0,
						totalTokens:
							usage.total_tokens ??
							(usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
					}
				: undefined,
		};
	}

	private buildUrl(path: string): string {
		const base = new URL(`${this.baseUrl}/`);
		const url = new URL(path, base);
		if (this.apiVersion) {
			url.searchParams.set("api-version", this.apiVersion);
		}
		return url.toString();
	}
}
