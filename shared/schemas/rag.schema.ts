import { z } from "zod";

export const searchRequestSchema = z.object({
	query: z.string().min(1),
	topK: z.number().int().min(1).max(20).optional(),
	category: z
		.string()
		.trim()
		.min(1)
		.regex(/^[^/]+$/, "Invalid category")
		.optional(),
});

export const chatMessageSchema = z.object({
	role: z.enum(["system", "user", "assistant"]),
	content: z.string(),
});

export const chatRequestSchema = z.object({
	conversationId: z.string().uuid().optional(),
	messages: z.array(chatMessageSchema).min(1),
	topK: z.number().int().min(1).max(20).optional(),
	category: z
		.string()
		.trim()
		.min(1)
		.regex(/^[^/]+$/, "Invalid category")
		.optional(),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
