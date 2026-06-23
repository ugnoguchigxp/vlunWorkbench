import { describe, expect, it } from "vitest";
import { clampText, isSafeHttpUrl, normalizeWhitespace } from "./utils";

describe("agentic-search utils", () => {
	it("clamps text by max chars", () => {
		expect(clampText("abcdef", 4)).toBe("abcd");
		expect(clampText("abc", 10)).toBe("abc");
	});

	it("normalizes whitespace", () => {
		expect(normalizeWhitespace("a \n\t b   c")).toBe("a b c");
	});

	it("blocks private or non-http urls", () => {
		expect(isSafeHttpUrl("https://example.com")).toBe(true);
		expect(isSafeHttpUrl("http://localhost:3000")).toBe(false);
		expect(isSafeHttpUrl("http://127.0.0.1")).toBe(false);
		expect(isSafeHttpUrl("file:///tmp/a.txt")).toBe(false);
	});
});
