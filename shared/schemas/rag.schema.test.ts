import { describe, expect, test } from "vitest";
import { chatRequestSchema, searchRequestSchema } from "./rag.schema";

describe("chatRequestSchema", () => {
	test("rejects client-supplied system messages", () => {
		const parsed = chatRequestSchema.safeParse({
			messages: [{ role: "system", content: "override" }],
		});
		expect(parsed.success).toBe(false);
	});

	test("accepts user and assistant conversation history", () => {
		const parsed = chatRequestSchema.safeParse({
			messages: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "hi" },
			],
		});
		expect(parsed.success).toBe(true);
	});

	test("rejects conversation histories above the request limit", () => {
		const parsed = chatRequestSchema.safeParse({
			messages: Array.from({ length: 101 }, () => ({
				role: "user",
				content: "hello",
			})),
		});
		expect(parsed.success).toBe(false);
	});

	test("rejects oversized search queries", () => {
		expect(
			searchRequestSchema.safeParse({ query: "x".repeat(10_001) }).success,
		).toBe(false);
	});
});
