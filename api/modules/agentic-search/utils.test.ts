import { describe, expect, it } from "vitest";
import { clampText, normalizeWhitespace } from "./utils";

describe("agentic-search utils", () => {
	it("clamps text by max chars", () => {
		expect(clampText("abcdef", 4)).toBe("abcd");
		expect(clampText("abc", 10)).toBe("abc");
	});

	it("normalizes whitespace", () => {
		expect(normalizeWhitespace("a \n\t b   c")).toBe("a b c");
	});

});
