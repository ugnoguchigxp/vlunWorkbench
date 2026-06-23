import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppDatabase } from "../db";
import { artifacts, conversations } from "../db/schema";
import { getAuthContextUser } from "../modules/auth/context";

const ArtifactsQuerySchema = z.object({
	conversationId: z.string().uuid().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});

const ArtifactContentSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
	z.array(z.unknown()),
	z.record(z.string(), z.unknown()),
]);

const ArtifactParamSchema = z.object({
	artifactId: z.string().uuid(),
});

const UpdateArtifactSchema = z.object({
	title: z.string().optional(),
	content: ArtifactContentSchema,
	version: z.coerce.number().int().positive().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

type ArtifactsRouteDeps = {
	db: AppDatabase;
};

export function createArtifactsRoute(deps: ArtifactsRouteDeps) {
	return new Hono()
		.get("/", zValidator("query", ArtifactsQuerySchema), async (c) => {
			const authUser = getAuthContextUser(c);
			const { conversationId, limit } = c.req.valid("query");
			const whereClause = and(
				eq(conversations.userId, authUser.userId),
				...(conversationId
					? [eq(artifacts.conversationId, conversationId)]
					: []),
			);
			const items = await deps.db
				.select({
					id: artifacts.id,
					conversationId: artifacts.conversationId,
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
				.innerJoin(
					conversations,
					eq(artifacts.conversationId, conversations.id),
				)
				.where(whereClause)
				.orderBy(desc(artifacts.updatedAt))
				.limit(limit);
			return c.json({ items });
		})
		.get(
			"/:artifactId",
			zValidator("param", ArtifactParamSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const { artifactId } = c.req.valid("param");
				const [item] = await deps.db
					.select({
						id: artifacts.id,
						conversationId: artifacts.conversationId,
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
					.innerJoin(
						conversations,
						eq(artifacts.conversationId, conversations.id),
					)
					.where(
						and(
							eq(artifacts.id, artifactId),
							eq(conversations.userId, authUser.userId),
						),
					)
					.limit(1);
				if (!item) {
					return c.json({ message: "Artifact not found" }, 404);
				}
				return c.json(item);
			},
		)
		.put(
			"/:artifactId",
			zValidator("param", ArtifactParamSchema),
			zValidator("json", UpdateArtifactSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const { artifactId } = c.req.valid("param");
				const payload = c.req.valid("json");
				const [existing] = await deps.db
					.select({
						id: artifacts.id,
						version: artifacts.version,
						metadata: artifacts.metadata,
					})
					.from(artifacts)
					.innerJoin(
						conversations,
						eq(artifacts.conversationId, conversations.id),
					)
					.where(
						and(
							eq(artifacts.id, artifactId),
							eq(conversations.userId, authUser.userId),
						),
					)
					.limit(1);
				if (!existing) {
					return c.json({ message: "Artifact not found" }, 404);
				}

				const nextVersion = payload.version ?? existing.version + 1;
				const [updated] = await deps.db
					.update(artifacts)
					.set({
						title: payload.title ?? null,
						content: payload.content,
						version: nextVersion,
						metadata:
							payload.metadata ??
							(existing.metadata as Record<string, unknown>),
						updatedAt: new Date(),
					})
					.where(eq(artifacts.id, artifactId))
					.returning({
						id: artifacts.id,
						conversationId: artifacts.conversationId,
						messageId: artifacts.messageId,
						type: artifacts.type,
						title: artifacts.title,
						content: artifacts.content,
						version: artifacts.version,
						metadata: artifacts.metadata,
						createdAt: artifacts.createdAt,
						updatedAt: artifacts.updatedAt,
					});
				return c.json(updated);
			},
		);
}
