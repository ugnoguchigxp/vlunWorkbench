import { describe, expect, test } from "vitest";
import { chatRequestSchema } from "./rag.schema";

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
});
