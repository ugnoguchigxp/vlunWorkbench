PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL UNIQUE,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"last_login_at" integer,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" ("role");
CREATE INDEX IF NOT EXISTS "users_is_active_idx" ON "users" ("is_active");

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL UNIQUE,
	"user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"expires_at" integer NOT NULL,
	"created_at" integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_idx" ON "refresh_tokens" ("token");
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens" ("expires_at");
