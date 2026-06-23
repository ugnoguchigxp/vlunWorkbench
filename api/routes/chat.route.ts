import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { chatRequestSchema } from "../../shared/schemas/rag.schema";
import type { AppDatabase } from "../db";
import {
	artifacts,
	conversations,
	messages,
	retrievalLogs,
} from "../db/schema";
import { getAuthContextUser } from "../modules/auth/context";
import { ChatService } from "../modules/chat/chat.service";
import type { SearchEvidenceCollector } from "../modules/rag/search-evidence";
import type { LlmProvider } from "../providers/types";
import type { ChatMessage } from "../types/llm";

const ConversationsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

const RetrievalLogsQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

const ConversationParamSchema = z.object({
	conversationId: z.string().uuid(),
});

type ChatRouteDeps = {
	db: AppDatabase;
	llmProvider: LlmProvider;
	evidenceCollector: SearchEvidenceCollector;
};

export function createChatRoute(deps: ChatRouteDeps) {
	const service = new ChatService({
		db: deps.db,
		llmProvider: deps.llmProvider,
		evidenceCollector: deps.evidenceCollector,
	});

	return new Hono()
		.get(
			"/conversations",
			zValidator("query", ConversationsQuerySchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const { limit } = c.req.valid("query");
				const rows = await deps.db
					.select({
						id: conversations.id,
						title: conversations.title,
						metadata: conversations.metadata,
						createdAt: conversations.createdAt,
						updatedAt: conversations.updatedAt,
					})
					.from(conversations)
					.where(eq(conversations.userId, authUser.userId))
					.orderBy(desc(conversations.updatedAt), desc(conversations.createdAt))
					.limit(limit);
				return c.json({ items: rows });
			},
		)
		.get(
			"/conversations/:conversationId/messages",
			zValidator("param", ConversationParamSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const { conversationId } = c.req.valid("param");
				const existingConversation =
					await deps.db.query.conversations.findFirst({
						where: and(
							eq(conversations.id, conversationId),
							eq(conversations.userId, authUser.userId),
						),
						columns: { id: true },
					});
				if (!existingConversation) {
					return c.json({ message: "Conversation not found" }, 404);
				}

				const [messageRows, artifactRows] = await Promise.all([
					deps.db
						.select({
							id: messages.id,
							role: messages.role,
							content: messages.content,
							metadata: messages.metadata,
							createdAt: messages.createdAt,
						})
						.from(messages)
						.where(eq(messages.conversationId, conversationId))
						.orderBy(messages.createdAt),
					deps.db
						.select({
							id: artifacts.id,
							messageId: artifacts.messageId,
							type: artifacts.type,
							title: artifacts.title,
							content: artifacts.content,
							version: artifacts.version,
							metadata: artifacts.metadata,
							createdAt: artifacts.createdAt,
							updatedAt: artifacts.updatedAt,
						})
						.from(artifacts)
						.where(eq(artifacts.conversationId, conversationId))
						.orderBy(artifacts.createdAt),
				]);

				const artifactsByMessageId = new Map<string, typeof artifactRows>();
				for (const artifact of artifactRows) {
					const items = artifactsByMessageId.get(artifact.messageId) ?? [];
					items.push(artifact);
					artifactsByMessageId.set(artifact.messageId, items);
				}

				return c.json({
					conversationId,
					items: messageRows.map((message) => ({
						...message,
						artifacts: artifactsByMessageId.get(message.id) ?? [],
					})),
				});
			},
		)
		.get(
			"/conversations/:conversationId/retrieval-logs",
			zValidator("query", RetrievalLogsQuerySchema),
			zValidator("param", ConversationParamSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const { conversationId } = c.req.valid("param");
				const { limit } = c.req.valid("query");
				const existingConversation =
					await deps.db.query.conversations.findFirst({
						where: and(
							eq(conversations.id, conversationId),
							eq(conversations.userId, authUser.userId),
						),
						columns: { id: true },
					});
				if (!existingConversation) {
					return c.json({ message: "Conversation not found" }, 404);
				}
				const rows = await deps.db
					.select({
						id: retrievalLogs.id,
						messageId: retrievalLogs.messageId,
						query: retrievalLogs.query,
						fragmentIds: retrievalLogs.fragmentIds,
						scores: retrievalLogs.scores,
						context: retrievalLogs.context,
						createdAt: retrievalLogs.createdAt,
					})
					.from(retrievalLogs)
					.where(eq(retrievalLogs.conversationId, conversationId))
					.orderBy(desc(retrievalLogs.createdAt))
					.limit(limit);
				return c.json({ items: rows });
			},
		)
		.delete(
			"/conversations/:conversationId",
			zValidator("param", ConversationParamSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const { conversationId } = c.req.valid("param");
				const existingConversation =
					await deps.db.query.conversations.findFirst({
						where: and(
							eq(conversations.id, conversationId),
							eq(conversations.userId, authUser.userId),
						),
						columns: { id: true },
					});
				if (!existingConversation) {
					return c.json({ message: "Conversation not found" }, 404);
				}

				await deps.db
					.delete(conversations)
					.where(
						and(
							eq(conversations.id, conversationId),
							eq(conversations.userId, authUser.userId),
						),
					);

				return c.json({ ok: true });
			},
		)
		.post("/", zValidator("json", chatRequestSchema), async (c) => {
			const authUser = getAuthContextUser(c);
			const body = c.req.valid("json");
			const result = await service.run({
				messages: body.messages as ChatMessage[],
				userId: authUser.userId,
				conversationId: body.conversationId,
				topK: body.topK,
				category: body.category,
			});
			return c.json(result);
		})
		.post("/stream", zValidator("json", chatRequestSchema), async (c) => {
			const authUser = getAuthContextUser(c);
			const body = c.req.valid("json");

			return streamSSE(c, async (stream) => {
				try {
					const result = await service.run({
						messages: body.messages as ChatMessage[],
						userId: authUser.userId,
						conversationId: body.conversationId,
						topK: body.topK,
						category: body.category,
					});

					await stream.writeSSE({
						event: "message_start",
						data: JSON.stringify({
							type: "message_start",
							conversationId: result.conversationId,
							messageId: result.id,
						}),
					});
					await stream.writeSSE({
						event: "retrieval_result",
						data: JSON.stringify({
							type: "retrieval_result",
							citations: result.citations,
							retrieved: result.retrieved,
						}),
					});
					await stream.writeSSE({
						event: "text_delta",
						data: JSON.stringify({
							type: "text_delta",
							messageId: result.id,
							delta: result.text,
						}),
					});
					for (const artifact of result.artifacts) {
						await stream.writeSSE({
							event: "artifact_complete",
							data: JSON.stringify({
								type: "artifact_complete",
								artifact,
							}),
						});
					}
					await stream.writeSSE({
						event: "message_complete",
						data: JSON.stringify({
							type: "message_complete",
							messageId: result.id,
							conversationId: result.conversationId,
							usage: result.usage,
						}),
					});
				} catch (error) {
					await stream.writeSSE({
						event: "error",
						data: JSON.stringify({
							type: "error",
							message:
								error instanceof Error ? error.message : "Stream chat failed",
						}),
					});
				}
			});
		});
}
