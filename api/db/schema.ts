import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
	blob,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const EMBEDDING_DIMENSIONS = 1536;

const nowMs = sql`(unixepoch() * 1000)`;
const id = (name = "id") =>
	text(name)
		.primaryKey()
		.$defaultFn(() => randomUUID());
const jsonObject = (name: string) =>
	text(name, { mode: "json" })
		.$type<Record<string, unknown>>()
		.default(sql`'{}'`)
		.notNull();
const jsonArray = (name: string) =>
	text(name, { mode: "json" }).$type<string[]>().default(sql`'[]'`).notNull();
const timestampMs = (name: string) =>
	integer(name, { mode: "timestamp_ms" })
		.default(nowMs)
		.$defaultFn(() => new Date())
		.notNull();

export const users = sqliteTable(
	"users",
	{
		id: id(),
		email: text("email").notNull().unique(),
		passwordHash: text("password_hash").notNull(),
		displayName: text("display_name").notNull(),
		role: text("role").notNull().default("member"),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		emailIdx: uniqueIndex("users_email_idx").on(table.email),
		roleIdx: index("users_role_idx").on(table.role),
		isActiveIdx: index("users_is_active_idx").on(table.isActive),
	}),
);

export const refreshTokens = sqliteTable(
	"refresh_tokens",
	{
		id: id(),
		token: text("token").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		tokenIdx: uniqueIndex("refresh_tokens_token_idx").on(table.token),
		userIdIdx: index("refresh_tokens_user_id_idx").on(table.userId),
		expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
	}),
);

export const sources = sqliteTable(
	"sources",
	{
		id: id(),
		sourceKind: text("source_kind").notNull(),
		category: text("category").default("tech").notNull(),
		uri: text("uri").notNull(),
		title: text("title"),
		body: text("body").notNull(),
		contentHash: text("content_hash").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
		lastIndexedAt: integer("last_indexed_at", { mode: "timestamp_ms" }),
	},
	(table) => ({
		uriUniqueIdx: uniqueIndex("sources_uri_idx").on(table.uri),
		sourceKindIdx: index("sources_source_kind_idx").on(table.sourceKind),
		sourceKindCategoryIdx: index("sources_source_kind_category_idx").on(
			table.sourceKind,
			table.category,
		),
		contentHashIdx: index("sources_content_hash_idx").on(table.contentHash),
	}),
);

export const sourceFragments = sqliteTable(
	"source_fragments",
	{
		id: id(),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		locator: text("locator").notNull(),
		heading: text("heading"),
		content: text("content").notNull(),
		embedding: blob("embedding", { mode: "buffer" }),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		sourceIdx: index("source_fragments_source_id_idx").on(table.sourceId),
		sourceLocatorIdx: uniqueIndex("source_fragments_source_locator_idx").on(
			table.sourceId,
			table.locator,
		),
	}),
);

export const conversations = sqliteTable(
	"conversations",
	{
		id: id(),
		userId: text("user_id").references(() => users.id, {
			onDelete: "cascade",
		}),
		title: text("title"),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		userIdx: index("conversations_user_id_idx").on(table.userId),
	}),
);

export const messages = sqliteTable(
	"messages",
	{
		id: id(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		role: text("role").notNull(),
		content: text("content").notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		conversationIdx: index("messages_conversation_id_idx").on(
			table.conversationId,
		),
	}),
);

export const artifacts = sqliteTable(
	"artifacts",
	{
		id: id(),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		messageId: text("message_id")
			.notNull()
			.references(() => messages.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		title: text("title"),
		content: text("content", { mode: "json" }).$type<unknown>().notNull(),
		version: integer("version").default(1).notNull(),
		metadata: jsonObject("metadata"),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		conversationIdx: index("artifacts_conversation_id_idx").on(
			table.conversationId,
		),
		messageIdx: index("artifacts_message_id_idx").on(table.messageId),
	}),
);

export const retrievalLogs = sqliteTable(
	"retrieval_logs",
	{
		id: id(),
		conversationId: text("conversation_id").references(() => conversations.id, {
			onDelete: "set null",
		}),
		messageId: text("message_id").references(() => messages.id, {
			onDelete: "set null",
		}),
		query: text("query").notNull(),
		fragmentIds: jsonArray("fragment_ids"),
		scores: jsonObject("scores"),
		context: jsonObject("context"),
		createdAt: timestampMs("created_at"),
	},
	(table) => ({
		conversationIdx: index("retrieval_logs_conversation_id_idx").on(
			table.conversationId,
		),
		messageIdx: index("retrieval_logs_message_id_idx").on(table.messageId),
	}),
);

export const userSettings = sqliteTable("user_settings", {
	userId: text("user_id").primaryKey(),
	systemContext: text("system_context").default("").notNull(),
	createdAt: timestampMs("created_at"),
	updatedAt: timestampMs("updated_at"),
});
