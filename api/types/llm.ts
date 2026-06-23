import { z } from "zod";

export const ChatRoleSchema = z.enum(["system", "user", "assistant"]);

export const ChatMessageSchema = z.object({
	role: ChatRoleSchema,
	content: z.string(),
});

export const ChatRequestSchema = z.object({
	messages: z.array(ChatMessageSchema),
	temperature: z.number().optional(),
	model: z.string().optional(),
});

export const RagRequestSchema = ChatRequestSchema.extend({
	top_k: z.number().int().min(1).max(8).optional(),
	max_context_chars: z.number().int().positive().optional(),
	context: z.record(z.string(), z.string()).optional(),
});

export const AzureChatResponseSchema = z.object({
	id: z.string(),
	choices: z.array(
		z.object({
			index: z.number().optional(),
			message: ChatMessageSchema,
			finish_reason: z.string().optional(),
		}),
	),
	usage: z
		.object({
			prompt_tokens: z.number(),
			completion_tokens: z.number(),
			total_tokens: z.number(),
		})
		.optional(),
});

export const SearchPlanSchema = z.object({
	should_search: z.boolean(),
	search_query: z.string(),
	force_web_search: z.boolean().optional(),
	top_k: z.number().int().min(1).max(8).optional(),
	reason: z.string().optional(),
	knowledge_source: z.string().optional(),
	identified_entities: z.array(z.string()).optional(),
	navigation_intent: z
		.object({
			target_route_key: z.string().optional(),
			patient_name: z.string().optional(),
		})
		.optional(),
});

export const ActionSchema = z.object({
	type: z.literal("link_button"),
	label: z.string(),
	url: z.string(),
});

export type ChatRole = z.infer<typeof ChatRoleSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type RagRequest = z.infer<typeof RagRequestSchema>;
export type AzureChatResponse = z.infer<typeof AzureChatResponseSchema>;
export type SearchPlan = z.infer<typeof SearchPlanSchema>;
export type Action = z.infer<typeof ActionSchema>;

/**
 * SearchPlanの正規化: top_kを安全な整数に収める
 */
export function normalizeSearchPlan(
	plan: SearchPlan,
	defaultTopK = 5,
	minTopK = 1,
	maxTopK = 8,
): SearchPlan {
	const rawTopK = plan.top_k;
	const topK =
		typeof rawTopK === "number" && Number.isFinite(rawTopK)
			? Math.min(maxTopK, Math.max(minTopK, Math.floor(rawTopK)))
			: defaultTopK;

	return {
		...plan,
		force_web_search: plan.force_web_search ?? false,
		top_k: topK,
	};
}
