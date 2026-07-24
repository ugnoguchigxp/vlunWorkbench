import { z } from "zod";

export const searchRequestSchema = z.object({
	query: z.string().min(1),
	topK: z.number().int().min(1).max(20).optional(),
	category: z
		.string()
		.trim()
		.min(1)
		.max(128)
		.regex(/^[^/]+$/, "Invalid category")
		.optional(),
});

export const chatMessageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string().max(50_000),
});

export const chatRequestSchema = z.object({
	conversationId: z.string().uuid().optional(),
	messages: z.array(chatMessageSchema).min(1),
	topK: z.number().int().min(1).max(20).optional(),
	category: z
		.string()
		.trim()
		.min(1)
		.max(128)
		.regex(/^[^/]+$/, "Invalid category")
		.optional(),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
