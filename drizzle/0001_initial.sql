CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL UNIQUE,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text NOT NULL DEFAULT 'member',
	"is_active" integer NOT NULL DEFAULT 1,
	"last_login_at" integer,
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
	"updated_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" ("role");
CREATE INDEX IF NOT EXISTS "users_is_active_idx" ON "users" ("is_active");

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL UNIQUE,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"expires_at" integer NOT NULL,
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_idx" ON "refresh_tokens" ("token");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens" ("expires_at");

CREATE TABLE IF NOT EXISTS "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"category" text NOT NULL DEFAULT 'tech',
	"uri" text NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" text NOT NULL DEFAULT '{}',
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
	"updated_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
	"last_indexed_at" integer
);

CREATE UNIQUE INDEX IF NOT EXISTS "sources_uri_idx" ON "sources" ("uri");
CREATE INDEX IF NOT EXISTS "sources_source_kind_idx" ON "sources" ("source_kind");
CREATE INDEX IF NOT EXISTS "sources_source_kind_category_idx" ON "sources" ("source_kind", "category");
CREATE INDEX IF NOT EXISTS "sources_content_hash_idx" ON "sources" ("content_hash");

CREATE TABLE IF NOT EXISTS "source_fragments" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
	"locator" text NOT NULL,
	"heading" text,
	"content" text NOT NULL,
	"embedding" blob,
	"metadata" text NOT NULL DEFAULT '{}',
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS "source_fragments_source_id_idx" ON "source_fragments" ("source_id");
CREATE UNIQUE INDEX IF NOT EXISTS "source_fragments_source_locator_idx" ON "source_fragments" ("source_id", "locator");

CREATE TABLE IF NOT EXISTS "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
	"title" text,
	"metadata" text NOT NULL DEFAULT '{}',
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
	"updated_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS "conversations_user_id_idx" ON "conversations" ("user_id");

CREATE TABLE IF NOT EXISTS "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" text NOT NULL DEFAULT '{}',
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS "messages_conversation_id_idx" ON "messages" ("conversation_id");

CREATE TABLE IF NOT EXISTS "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"message_id" text NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
	"type" text NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"version" integer NOT NULL DEFAULT 1,
	"metadata" text NOT NULL DEFAULT '{}',
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
	"updated_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS "artifacts_conversation_id_idx" ON "artifacts" ("conversation_id");
CREATE INDEX IF NOT EXISTS "artifacts_message_id_idx" ON "artifacts" ("message_id");

CREATE TABLE IF NOT EXISTS "retrieval_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text REFERENCES "conversations"("id") ON DELETE SET NULL,
	"message_id" text REFERENCES "messages"("id") ON DELETE SET NULL,
	"query" text NOT NULL,
	"fragment_ids" text NOT NULL DEFAULT '[]',
	"scores" text NOT NULL DEFAULT '{}',
	"context" text NOT NULL DEFAULT '{}',
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS "retrieval_logs_conversation_id_idx" ON "retrieval_logs" ("conversation_id");
CREATE INDEX IF NOT EXISTS "retrieval_logs_message_id_idx" ON "retrieval_logs" ("message_id");

CREATE TABLE IF NOT EXISTS "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"system_context" text NOT NULL DEFAULT '',
	"created_at" integer NOT NULL DEFAULT (unixepoch() * 1000),
	"updated_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);
