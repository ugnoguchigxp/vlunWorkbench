import { describe, expect, it, vi } from "vitest";
import {
	conversations,
	messages,
	retrievalLogs,
} from "../../db/schema";
import { ChatService } from "./chat.service";

const createDbMock = () => {
	const inserted: Array<{ table: unknown; values: unknown }> = [];
	let messageIndex = 0;

	const db = {
		query: {
			conversations: {
				findFirst: vi.fn(),
			},
		},
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((values: unknown) => {
				inserted.push({ table, values });
				return {
					returning: vi.fn(async () => {
						if (table === conversations) {
							return [{ id: "conversation-1" }];
						}
						if (table === messages) {
							messageIndex += 1;
							return [{ id: `message-${messageIndex}` }];
						}
						return [];
					}),
				};
			}),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async () => undefined),
			})),
		})),
	};

	return { db, inserted };
};

describe("ChatService", () => {
	it("stores new conversations with the authenticated user id", async () => {
		const { db, inserted } = createDbMock();
		const llmProvider = {
			chatCompletion: vi.fn().mockResolvedValue({
				id: "decision-1",
				content: '{"shouldSearch":false,"answer":"answer"}',
			}),
		};
		const service = new ChatService({
			db: db as never,
			llmProvider,
			evidenceCollector: { collect: vi.fn() } as never,
		});

		const result = await service.run({
			userId: "user-1",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(result.conversationId).toBe("conversation-1");
		expect(inserted).toContainEqual({
			table: conversations,
			values: {
				userId: "user-1",
				title: "hello",
				metadata: {},
			},
		});
		expect(inserted.some((entry) => entry.table === retrievalLogs)).toBe(true);
		expect(result.systemContexts).toEqual([
			expect.objectContaining({
				key: "chat.searchDecision",
				renderedHash: expect.stringMatching(/^sha256:/),
			}),
		]);
		expect(result.promptMessages).toEqual([
			expect.objectContaining({
				key: "chat.searchDecision",
				messageRole: "system",
			}),
		]);
		expect(result.promptSequenceHashes).toEqual([
			expect.stringMatching(/^sha256:/),
		]);
		expect(
			inserted.find(
				(entry) =>
					entry.table === messages &&
					(entry.values as { role?: string }).role === "assistant",
			)?.values,
		).toMatchObject({
			metadata: {
				systemContexts: [
					expect.objectContaining({ key: "chat.searchDecision" }),
				],
				promptMessages: [
					expect.objectContaining({ key: "chat.searchDecision" }),
				],
				promptSequenceHashes: [expect.stringMatching(/^sha256:/)],
			},
		});
	});

	it("rejects an existing conversation id outside the authenticated user's scope", async () => {
		const { db } = createDbMock();
		db.query.conversations.findFirst.mockResolvedValue(null);
		const llmProvider = {
			chatCompletion: vi.fn().mockResolvedValue({
				id: "decision-1",
				content: '{"shouldSearch":false,"answer":"answer"}',
			}),
		};
		const service = new ChatService({
			db: db as never,
			llmProvider,
			evidenceCollector: { collect: vi.fn() } as never,
		});

		await expect(
			service.run({
				userId: "user-1",
				conversationId: "00000000-0000-0000-0000-000000000001",
				messages: [{ role: "user", content: "hello" }],
			}),
		).rejects.toThrow("Conversation not found.");

		expect(llmProvider.chatCompletion).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalledWith(conversations);
	});
});
