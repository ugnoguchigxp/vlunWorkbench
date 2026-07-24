import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	artifacts,
	conversations,
	messages as messageTable,
	retrievalLogs,
} from "../../db/schema";
import type { LlmProvider } from "../../providers/types";
import type {
	PromptMessageManifest,
	SystemContextManifest,
} from "../../system-context/audit";
import {
	bindChatDirectAnswerSystemContext,
	bindChatGroundedAnswerSystemContext,
	bindChatSearchDecisionSystemContext,
} from "../../system-context/bindings";
import {
	type ApplicationChatMessage,
	executeLlmCompletion,
} from "../../system-context/llm-execution";
import { extractArtifactsFromText } from "../artifacts/extract";
import type { Artifact } from "../artifacts/types";
import { HttpError } from "../auth/errors";
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
	systemContexts: SystemContextManifest[];
	promptMessages: PromptMessageManifest[];
	promptSequenceHashes: string[];
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
	messages: ApplicationChatMessage[];
	userId: string;
	conversationId?: string;
	topK?: number;
	category?: string;
};

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

	private async decideSearch(messages: ApplicationChatMessage[]): Promise<{
		decision: ChatSearchDecision;
		systemContextManifest: SystemContextManifest;
		promptMessageManifests: readonly PromptMessageManifest[];
		promptSequenceHash: string;
	}> {
		const execution = await executeLlmCompletion({
			provider: this.deps.llmProvider,
			systemContext: bindChatSearchDecisionSystemContext(),
			messages,
			options: { temperature: 0 },
		});
		const response = execution.response;
		const decision = parseSearchDecision(response.content);
		if (decision) {
			return {
				decision,
				systemContextManifest: execution.systemContextManifest,
				promptMessageManifests: execution.promptMessageManifests,
				promptSequenceHash: execution.promptSequenceHash,
			};
		}
		return {
			decision: {
				shouldSearch: false,
				answer: response.content,
			},
			systemContextManifest: execution.systemContextManifest,
			promptMessageManifests: execution.promptMessageManifests,
			promptSequenceHash: execution.promptSequenceHash,
		};
	}

	private async directAnswer(messages: ApplicationChatMessage[]) {
		return await executeLlmCompletion({
			provider: this.deps.llmProvider,
			systemContext: bindChatDirectAnswerSystemContext(),
			messages,
		});
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
		const decisionExecution = await this.decideSearch(request.messages);
		const decision = decisionExecution.decision;
		const systemContexts: SystemContextManifest[] = [
			decisionExecution.systemContextManifest,
		];
		const promptMessages: PromptMessageManifest[] = [
			...decisionExecution.promptMessageManifests,
		];
		const promptSequenceHashes = [decisionExecution.promptSequenceHash];
		let evidence: SearchEvidence | undefined;
		let llmResponse: Awaited<ReturnType<LlmProvider["chatCompletion"]>>;
		if (decision.shouldSearch) {
			const searchQuery = decision.searchQuery?.trim() || lastUserMessage;
			evidence = await this.deps.evidenceCollector.collect({
				query: searchQuery,
				topK,
				category,
			});
			const execution = await executeLlmCompletion({
				provider: this.deps.llmProvider,
				systemContext: bindChatGroundedAnswerSystemContext(
					evidence.localContext,
				),
				messages: request.messages,
			});
			llmResponse = execution.response;
			systemContexts.push(execution.systemContextManifest);
			promptMessages.push(...execution.promptMessageManifests);
			promptSequenceHashes.push(execution.promptSequenceHash);
		} else if (decision.answer?.trim()) {
			llmResponse = {
				id: randomUUID(),
				content: decision.answer,
			};
		} else {
			const execution = await this.directAnswer(request.messages);
			llmResponse = execution.response;
			systemContexts.push(execution.systemContextManifest);
			promptMessages.push(...execution.promptMessageManifests);
			promptSequenceHashes.push(execution.promptSequenceHash);
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
				metadata: {
					citations,
					systemContexts,
					promptMessages,
					promptSequenceHashes,
				},
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
				systemContexts,
				promptMessages,
				promptSequenceHashes,
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
			systemContexts,
			promptMessages,
			promptSequenceHashes,
			usage: llmResponse.usage,
		};
	}
}
