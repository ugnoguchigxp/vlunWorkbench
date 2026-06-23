import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getAuthContextUser } from "../modules/auth/context";
import type { AgenticSearchResult } from "../modules/agentic-search/types";

const AgenticSearchRequestSchema = z.object({
	query: z.string().trim().min(1),
	topK: z.number().int().min(1).max(20).optional(),
	category: z
		.string()
		.trim()
		.min(1)
		.regex(/^[^/]+$/, "Invalid category")
		.optional(),
});

type AgenticSearchRouteDeps = {
	service: {
		run(input: {
			query: string;
			userId: string;
			topK: number;
			category?: string;
		}): Promise<AgenticSearchResult>;
	};
};

export function createAgenticSearchRoute(deps: AgenticSearchRouteDeps) {
	if (!deps?.service) {
		throw new Error("agentic search service is not configured");
	}

	return new Hono().post(
		"/",
		zValidator("json", AgenticSearchRequestSchema),
		async (c) => {
			const requestId = randomUUID();
			const authUser = getAuthContextUser(c);
			const body = c.req.valid("json");
			const startedAt = Date.now();
			console.log(
				`[agentic-search][route] request.start ${JSON.stringify({
					requestId,
					queryLength: body.query.length,
					category: body.category ?? null,
					topK: body.topK ?? 8,
				})}`,
			);
			try {
				const result = await deps.service.run({
					query: body.query,
					userId: authUser.userId,
					topK: body.topK ?? 8,
					category: body.category,
				});
				console.log(
					`[agentic-search][route] request.complete ${JSON.stringify({
						requestId,
						elapsedMs: Date.now() - startedAt,
						citations: result.citations.length,
						toolTrace: result.toolTrace.length,
						usageTotalTokens: result.usage?.totalTokens ?? null,
					})}`,
				);
				return c.json(result);
			} catch (error) {
				console.error(
					`[agentic-search][route] request.error ${JSON.stringify({
						requestId,
						elapsedMs: Date.now() - startedAt,
						message:
							error instanceof Error ? error.message : "unknown route error",
					})}`,
				);
				throw error;
			}
		},
	);
}
