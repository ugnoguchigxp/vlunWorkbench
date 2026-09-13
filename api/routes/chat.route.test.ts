import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../db";
import { conversations, users } from "../db/schema";
import { createChatRoute } from "./chat.route";

function migrate(connection: DbConnection): void {
	for (const filename of readdirSync(path.resolve("drizzle"))
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		connection.sqlite.exec(
			readFileSync(path.resolve("drizzle", filename), "utf8"),
		);
	}
}

describe("chat route", () => {
	let connection: DbConnection;
	let app: Hono;
	let userId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		migrate(connection);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "chat@example.com",
				passwordHash: "hash",
				displayName: "Chat",
				role: "member",
				isActive: true,
			})
			.returning();
		userId = user.id;
		app = new Hono();
		app.use("*", async (c, next) => {
			c.set("authUser", {
				userId,
				email: "chat@example.com",
				role: "member",
			});
			await next();
		});
		app.route(
			"/api/chat",
			createChatRoute({
				db: connection.db,
				llmProvider: {
					chatCompletion: async () => ({ id: "llm", content: "ok" }),
				},
				evidenceCollector: {
					collect: async () => ({
						query: "",
						fragments: [],
						citations: [],
					}),
				} as never,
			}),
		);
	});

	afterEach(() => {
		connection.sqlite.close(false);
	});

	it("lists, reads, and deletes owned conversations", async () => {
		const conversationId = "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1";
		await connection.db.insert(conversations).values({
			id: conversationId,
			userId,
			title: "Owned",
			metadata: {},
		});
		expect((await app.request("/api/chat/conversations")).status).toBe(200);
		expect(
			(await app.request(`/api/chat/conversations/${conversationId}/messages`))
				.status,
		).toBe(200);
		expect(
			(
				await app.request(
					`/api/chat/conversations/${conversationId}/retrieval-logs`,
				)
			).status,
		).toBe(200);
		const missing = "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1";
		expect(
			(await app.request(`/api/chat/conversations/${missing}/messages`)).status,
		).toBe(404);
		expect(
			(await app.request(`/api/chat/conversations/${missing}/retrieval-logs`))
				.status,
		).toBe(404);
		expect(
			(
				await app.request(`/api/chat/conversations/${missing}`, {
					method: "DELETE",
				})
			).status,
		).toBe(404);
		expect(
			(
				await app.request(`/api/chat/conversations/${conversationId}`, {
					method: "DELETE",
				})
			).status,
		).toBe(200);
	});

	it("answers and streams a chat request for the authenticated user", async () => {
		const body = JSON.stringify({
			messages: [{ role: "user", content: "hello" }],
		});
		const json = await app.request("/api/chat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		expect(json.status).toBe(200);
		const payload = (await json.json()) as { conversationId: string; text: string };
		expect(payload.text).toBe("ok");
		expect(payload.conversationId).toMatch(
			/^[0-9a-f-]{36}$/i,
		);

		const stream = await app.request("/api/chat/stream", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		expect(stream.status).toBe(200);
		const events = await stream.text();
		expect(events).toContain("message_start");
		expect(events).toContain("message_complete");

		const failed = await app.request("/api/chat/stream", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				conversationId: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
				messages: [{ role: "user", content: "missing" }],
			}),
		});
		expect(await failed.text()).toContain("error");
	});
});
