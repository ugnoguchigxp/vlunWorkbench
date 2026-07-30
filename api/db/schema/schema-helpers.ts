import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";

export const EMBEDDING_DIMENSIONS = 1536;
export const nowMs = sql`(unixepoch() * 1000)`;
export const id = (name = "id") =>
	text(name)
		.primaryKey()
		.$defaultFn(() => randomUUID());
export const jsonObject = (name: string) =>
	text(name, { mode: "json" })
		.$type<Record<string, unknown>>()
		.default(sql`'{}'`)
		.notNull();
export const jsonArray = (name: string) =>
	text(name, { mode: "json" }).$type<string[]>().default(sql`'[]'`).notNull();
export const timestampMs = (name: string) =>
	integer(name, { mode: "timestamp_ms" })
		.default(nowMs)
		.$defaultFn(() => new Date())
		.notNull();
