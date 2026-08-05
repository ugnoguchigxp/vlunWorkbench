import { randomUUID } from "node:crypto";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
	"users",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => randomUUID()),
		email: text("email").notNull().unique(),
		passwordHash: text("password_hash").notNull(),
		displayName: text("display_name").notNull(),
		role: text("role").notNull().default("member"),
		isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
		lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
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
		id: text("id")
			.primaryKey()
			.$defaultFn(() => randomUUID()),
		token: text("token").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		tokenIdx: uniqueIndex("refresh_tokens_token_idx").on(table.token),
		userIdIdx: index("refresh_tokens_user_id_idx").on(table.userId),
		expiresAtIdx: index("refresh_tokens_expires_at_idx").on(table.expiresAt),
	}),
);
