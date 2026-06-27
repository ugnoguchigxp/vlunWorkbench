import { describe, expect, it } from "vitest";
import { buildAgenticSystemContext } from "./system-context";

describe("buildAgenticSystemContext", () => {
	it("includes defaults and user context", () => {
		const context = buildAgenticSystemContext({
			userSystemContext: "Answer with strict citations.",
			category: "tech",
			topK: 8,
		});
		expect(context).toContain("search_evidence");
		expect(context).toContain("full-text search");
		expect(context).toContain("vector search");
		expect(context).toContain("web search");
		expect(context).toContain("Answer with strict citations.");
		expect(context).toContain("Category scope は tech です。");
	});

	it("works without user context", () => {
		const context = buildAgenticSystemContext({
			userSystemContext: "   ",
			topK: 4,
		});
		expect(context).not.toContain("[User SystemContext]");
		expect(context).toContain("既定の retrieval topK は 4 です。");
	});
});
