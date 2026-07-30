import { sql } from "drizzle-orm";
import {
	blob,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { id, jsonArray, jsonObject, timestampMs } from "./schema-helpers";

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

export const llmProviderEndpoints = sqliteTable(
	"llm_provider_endpoints",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		kind: text("kind").notNull(),
		enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
		apiKey: text("api_key"),
		apiKeyCiphertext: text("api_key_ciphertext"),
		apiKeyNonce: text("api_key_nonce"),
		apiKeyAuthTag: text("api_key_auth_tag"),
		apiKeyKeyId: text("api_key_key_id"),
		baseUrl: text("base_url"),
		endpoint: text("endpoint"),
		apiVersion: text("api_version"),
		region: text("region"),
		models: jsonArray("models"),
		modelDisplayNames: text("model_display_names", { mode: "json" })
			.$type<Record<string, string>>()
			.default(sql`'{}'`)
			.notNull(),
		defaultModelCapability: text("default_model_capability", { mode: "json" })
			.$type<Record<string, unknown> | null>()
			.default(sql`null`),
		modelCapabilities: text("model_capabilities", { mode: "json" })
			.$type<Record<string, Record<string, unknown>>>()
			.default(sql`'{}'`)
			.notNull(),
		createdAt: timestampMs("created_at"),
		updatedAt: timestampMs("updated_at"),
	},
	(table) => ({
		kindIdx: index("llm_provider_endpoints_kind_idx").on(table.kind),
		enabledIdx: index("llm_provider_endpoints_enabled_idx").on(table.enabled),
	}),
);

export const llmTaskRoutes = sqliteTable("llm_task_routes", {
	task: text("task").primaryKey(),
	primaryProviderEndpointId: text("primary_provider_endpoint_id").references(
		() => llmProviderEndpoints.id,
		{ onDelete: "set null" },
	),
	primaryModel: text("primary_model"),
	primaryThinkingDepth: text("primary_thinking_depth"),
	fallbackTargets: text("fallback_targets", { mode: "json" })
		.$type<
			Array<{
				providerEndpointId: string;
				model: string;
				thinkingDepth?: string;
			}>
		>()
		.default(sql`'[]'`)
		.notNull(),
	policy: jsonObject("policy"),
	createdAt: timestampMs("created_at"),
	updatedAt: timestampMs("updated_at"),
});

export const llmProviderHealthChecks = sqliteTable(
	"llm_provider_health_checks",
	{
		id: id(),
		providerEndpointId: text("provider_endpoint_id")
			.notNull()
			.references(() => llmProviderEndpoints.id, { onDelete: "cascade" }),
		ok: integer("ok", { mode: "boolean" }).notNull(),
		reachable: integer("reachable", { mode: "boolean" }).notNull(),
		status: text("status").notNull(),
		url: text("url"),
		message: text("message"),
		durationMs: integer("duration_ms").notNull(),
		checkedAt: timestampMs("checked_at"),
	},
	(table) => ({
		providerEndpointIdIdx: index("llm_provider_health_checks_endpoint_idx").on(
			table.providerEndpointId,
		),
		checkedAtIdx: index("llm_provider_health_checks_checked_at_idx").on(
			table.checkedAt,
		),
	}),
);
