import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	artifacts,
	conversations,
	messages as messageTable,
	retrievalLogs,
} from "../../db/schema";
import { HttpError } from "../auth/errors";
import type { LlmProvider } from "../../providers/types";
import type { ChatMessage } from "../../types/llm";
import { extractArtifactsFromText } from "../artifacts/extract";
import type { Artifact } from "../artifacts/types";
import type {
	SearchEvidence,
	SearchEvidenceCollector,
} from "../rag/search-evidence";
import type { Citation, RetrievedFragment } from "../rag/types";

export type ChatResult = {
	id: string;
	conversationId: string;
	text: string;
	citations: Citation[];
	artifacts: Artifact[];
	retrieved: RetrievedFragment[];
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
};

type ChatServiceDeps = {
	db: AppDatabase;
	llmProvider: LlmProvider;
	evidenceCollector: SearchEvidenceCollector;
};

type ChatRequest = {
	messages: ChatMessage[];
	userId: string;
	conversationId?: string;
	topK?: number;
	category?: string;
};

function buildSystemPrompt(localContext: string): string {
	return [
		"You are a helpful assistant.",
		"Use the provided local markdown context when it is relevant.",
		"Cite uncertain points conservatively.",
		'If you generate structured output, use <artifact type="..."> blocks.',
		"Avoid overusing Markdown headings (like #, ##, ###). Instead, use a balanced mix of paragraphs, bullet points, and bold text to make the answer clear and readable.",
		`Local markdown context:\n${localContext}`,
	].join("\n\n");
}

type ChatSearchDecision = {
	shouldSearch: boolean;
	searchQuery?: string;
	answer?: string;
};

function extractJsonObject(input: string): string | null {
	const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced?.[1] ?? input;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end < start) return null;
	return candidate.slice(start, end + 1);
}

function parseSearchDecision(input: string): ChatSearchDecision | null {
	const json = extractJsonObject(input);
	if (!json) return null;
	try {
		const parsed = JSON.parse(json) as Record<string, unknown>;
		return {
			shouldSearch: parsed.shouldSearch === true,
			searchQuery:
				typeof parsed.searchQuery === "string" ? parsed.searchQuery : undefined,
			answer: typeof parsed.answer === "string" ? parsed.answer : undefined,
		};
	} catch {
		return null;
	}
}

function buildSearchDecisionPrompt(): string {
	return [
		"You decide whether search is required before answering.",
		"Do not search by default.",
		"If you can answer sufficiently from your own general knowledge, return JSON with shouldSearch=false and a complete Markdown answer.",
		"Search is required for local workspace/wiki/project-specific facts, current or time-sensitive facts, explicit search requests, citations, or when you are uncertain.",
		"If search is required, choose one concise searchQuery. The same query will be used for full-text search and vector search.",
		'Return only JSON: {"shouldSearch":false,"answer":"..."} or {"shouldSearch":true,"searchQuery":"..."}',
	].join("\n");
}

function buildDirectAnswerPrompt(): string {
	return [
		"You are a helpful assistant.",
		"Answer directly in Markdown without using retrieved context.",
		"If the user asks for current, local workspace, or source-grounded facts that require search, say that search is required instead of guessing.",
		'If you generate structured output, use <artifact type="..."> blocks.',
		"Avoid overusing Markdown headings (like #, ##, ###). Instead, use a balanced mix of paragraphs, bullet points, and bold text to make the answer clear and readable.",
	].join("\n");
}

function conversationTitleFromQuery(query: string): string {
	const trimmed = query.trim();
	if (!trimmed) return "Conversation";
	return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

export class ChatService {
	constructor(private readonly deps: ChatServiceDeps) {}

	private async findOwnedConversation(
		conversationId: string,
		userId: string,
	): Promise<{ id: string } | null> {
		const existing = await this.deps.db.query.conversations.findFirst({
			where: and(
				eq(conversations.id, conversationId),
				eq(conversations.userId, userId),
			),
			columns: { id: true },
		});
		return existing ?? null;
	}

	private async ensureConversation(
		conversationId: string | undefined,
		userId: string,
		query: string,
	): Promise<string> {
		if (conversationId) return conversationId;
		const [inserted] = await this.deps.db
			.insert(conversations)
			.values({
				userId,
				title: conversationTitleFromQuery(query),
				metadata: {},
			})
			.returning({ id: conversations.id });
		return inserted.id;
	}

	private async decideSearch(
		messages: ChatMessage[],
	): Promise<ChatSearchDecision> {
		const response = await this.deps.llmProvider.chatCompletion(
			[{ role: "system", content: buildSearchDecisionPrompt() }, ...messages],
			{ temperature: 0 },
		);
		const decision = parseSearchDecision(response.content);
		if (decision) return decision;
		return {
			shouldSearch: false,
			answer: response.content,
		};
	}

	private async directAnswer(messages: ChatMessage[]) {
		return await this.deps.llmProvider.chatCompletion([
			{ role: "system", content: buildDirectAnswerPrompt() },
			...messages,
		]);
	}

	async run(request: ChatRequest): Promise<ChatResult> {
		const lastUserMessage =
			[...request.messages].reverse().find((message) => message.role === "user")
				?.content ?? "";
		if (
			request.conversationId &&
			!(await this.findOwnedConversation(
				request.conversationId,
				request.userId,
			))
		) {
			throw new HttpError(404, "Conversation not found.");
		}
		const topK = request.topK ?? 8;
		const category = request.category?.trim() || undefined;
		const decision = await this.decideSearch(request.messages);
		let evidence: SearchEvidence | undefined;
		let llmResponse: Awaited<ReturnType<LlmProvider["chatCompletion"]>>;
		if (decision.shouldSearch) {
			const searchQuery = decision.searchQuery?.trim() || lastUserMessage;
			evidence = await this.deps.evidenceCollector.collect({
				query: searchQuery,
				topK,
				category,
			});
			const systemPrompt = buildSystemPrompt(evidence.localContext);
			llmResponse = await this.deps.llmProvider.chatCompletion([
				{ role: "system", content: systemPrompt },
				...request.messages,
			]);
		} else if (decision.answer?.trim()) {
			llmResponse = {
				id: randomUUID(),
				content: decision.answer,
			};
		} else {
			llmResponse = await this.directAnswer(request.messages);
		}
		const extracted = extractArtifactsFromText(llmResponse.content);
		const retrieved = evidence?.retrieved ?? [];
		const citations = evidence?.citations ?? [];

		const conversationId = await this.ensureConversation(
			request.conversationId,
			request.userId,
			lastUserMessage,
		);

		let userMessageId: string = randomUUID();
		if (lastUserMessage.trim()) {
			const [userMessage] = await this.deps.db
				.insert(messageTable)
				.values({
					conversationId,
					role: "user",
					content: lastUserMessage,
					metadata: {},
				})
				.returning({ id: messageTable.id });
			userMessageId = userMessage.id;
		}

		const [assistantMessage] = await this.deps.db
			.insert(messageTable)
			.values({
				conversationId,
				role: "assistant",
				content: extracted.cleanText,
				metadata: { citations },
			})
			.returning({ id: messageTable.id });

		if (extracted.artifacts.length > 0) {
			await this.deps.db.insert(artifacts).values(
				extracted.artifacts.map((artifact) => ({
					conversationId,
					messageId: assistantMessage.id,
					type: artifact.type,
					title: artifact.title ?? null,
					content: artifact.content as Record<string, unknown>,
					version: artifact.version,
					metadata: artifact.metadata,
				})),
			);
		}

		await this.deps.db.insert(retrievalLogs).values({
			conversationId,
			messageId: assistantMessage.id,
			query: lastUserMessage,
			fragmentIds: retrieved.map((item) => item.id),
			scores: {
				selected: retrieved.map((item) => ({
					id: item.id,
					combinedScore: item.combinedScore,
					vectorScore: item.vectorScore,
					textScore: item.textScore,
					trigramScore: item.trigramScore,
				})),
				vector: (evidence?.evaluation.vectorResults ?? []).map((item) => ({
					id: item.id,
					vectorScore: item.vectorScore,
				})),
				text: (evidence?.evaluation.textResults ?? []).map((item) => ({
					id: item.id,
					textScore: item.textScore,
				})),
				merged: (evidence?.evaluation.mergedResults ?? []).map((item) => ({
					id: item.id,
					combinedScore: item.combinedScore,
					vectorScore: item.vectorScore,
					textScore: item.textScore,
				})),
			},
			context: {
				userMessageId,
				searchUsed: Boolean(evidence),
				searchQuery: evidence?.query ?? null,
				contextLength: evidence?.localContext.length ?? 0,
				category: category ?? "all",
				retrievalStrategy: evidence?.evaluation.strategy ?? null,
				selectedCount: retrieved.length,
				vectorCount: evidence?.evaluation.vectorResults.length ?? 0,
				textCount: evidence?.evaluation.textResults.length ?? 0,
				mergedCount: evidence?.evaluation.mergedResults.length ?? 0,
			},
		});

		await this.deps.db
			.update(conversations)
			.set({ updatedAt: new Date() })
			.where(eq(conversations.id, conversationId));

		return {
			id: llmResponse.id,
			conversationId,
			text: extracted.cleanText,
			citations,
			artifacts: extracted.artifacts,
			retrieved,
			usage: llmResponse.usage,
		};
	}
}
