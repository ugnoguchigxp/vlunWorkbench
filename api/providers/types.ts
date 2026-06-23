import type { ChatMessage } from "../types/llm";

/**
 * LLM Chat Completion プロバイダーインターフェース
 * Azure OpenAI, OpenAI, Ollama 等の実装を差し替え可能
 */
export interface LlmProvider {
	chatCompletion(
		messages: ChatMessage[],
		options?: LlmCompletionOptions,
	): Promise<LlmResponse>;
}

export interface LlmCompletionOptions {
	temperature?: number;
	maxTokens?: number;
}

export interface LlmResponse {
	id: string;
	content: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

export interface ChatDelta {
	id: string;
	delta: string;
	finishReason?: string;
}

/**
 * Embedding プロバイダーインターフェース
 */
export interface EmbeddingProvider {
	createEmbedding(input: string): Promise<number[]>;
}

export interface StreamingLlmProvider extends LlmProvider {
	streamChatCompletion(
		messages: ChatMessage[],
		options?: LlmCompletionOptions,
	): AsyncIterable<ChatDelta>;
}

export function supportsStreaming(
	provider: LlmProvider,
): provider is StreamingLlmProvider {
	return "streamChatCompletion" in provider;
}

/**
 * Web 検索結果インターフェース
 */
export interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
	position: number;
}

/**
 * Web 検索オプションインターフェース
 */
export interface WebSearchOptions {
	query: string;
	maxResults?: number;
	lang?: string;
}

/**
 * Web 検索プロバイダーインターフェース
 */
export interface WebSearchProvider {
	readonly name?: string;
	search(options: WebSearchOptions): Promise<WebSearchResult[]>;
}
