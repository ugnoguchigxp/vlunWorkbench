import { describe, expect, it } from "vitest";
import type { OpenAiResponsesAdapter } from "./llm/openai-responses-adapter";
import { AgenticSearchRunner } from "./runner";
import type { AgenticFunctionToolSpec } from "./types";
import type { AgenticToolRegistry } from "./tools/registry";

type StubTurn = {
	responseId: string;
	text: string;
	functionCalls: Array<{ callId: string; name: string; argumentsJson: string }>;
	usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
};

class StubAdapter {
	public readonly calls: Array<{
		instructions: string;
		input: unknown[];
		previousResponseId?: string;
		tools: AgenticFunctionToolSpec[];
	}> = [];
	private index = 0;

	constructor(private readonly turns: StubTurn[]) {}

	async createTurn(params: {
		instructions: string;
		input: unknown[];
		tools: AgenticFunctionToolSpec[];
		previousResponseId?: string;
	}) {
		this.calls.push(params);
		const turn = this.turns[this.index];
		this.index += 1;
		if (!turn) {
			throw new Error("No stub turn prepared");
		}
		return turn;
	}
}

function createRegistryStub() {
	return {
		listSpecs: () =>
			[
				{
					type: "function" as const,
					name: "search_evidence",
					description: "search",
					parameters: { type: "object", properties: {} },
				},
			] satisfies AgenticFunctionToolSpec[],
		has: (name: string) => name === "search_evidence" || name === "fetch",
		execute: async (name: string) => {
			if (name === "search_evidence") {
				return {
					output: {
						hits: [{ id: "a" }],
					},
					resultCount: 1,
					citations: [
						{
							kind: "wiki_fragment" as const,
							title: "Doc A",
							uri: "wiki://a",
							locator: "chunk:0001",
							wikiSlug: "tech/a",
						},
						{
							kind: "wiki_fragment" as const,
							title: "Doc A",
							uri: "wiki://a",
							locator: "chunk:0002",
							wikiSlug: "tech/a",
						},
						{
							kind: "wiki_page" as const,
							title: "Doc A",
							uri: "wiki://a",
							wikiSlug: "tech/a",
						},
					],
				};
			}
			return {
				output: { fetched: true },
				resultCount: 1,
			};
		},
	};
}

describe("AgenticSearchRunner", () => {
	it("returns final text when no tool calls are requested", async () => {
		const adapter = new StubAdapter([
			{
				responseId: "resp_1",
				text: "final answer",
				functionCalls: [],
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			},
		]);
		const runner = new AgenticSearchRunner({
			llmAdapter: adapter as unknown as OpenAiResponsesAdapter,
			toolRegistry: createRegistryStub() as unknown as AgenticToolRegistry,
			options: {
				maxToolCalls: 5,
				maxFetchCalls: 2,
				maxContextChars: 5000,
			},
		});

		const result = await runner.run({
			query: "what is rag",
			topK: 8,
			systemContext: "context",
		});

		expect(result.answer).toBe("final answer");
		expect(result.toolTrace.length).toBe(0);
		expect(result.usage?.totalTokens).toBe(15);
		expect(adapter.calls.length).toBe(1);
	});

	it("executes tool calls and continues with previous_response_id", async () => {
		const adapter = new StubAdapter([
			{
				responseId: "resp_1",
				text: "",
				functionCalls: [
					{
						callId: "call_1",
						name: "search_evidence",
						argumentsJson: JSON.stringify({ query: "rag" }),
					},
				],
				usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
			},
			{
				responseId: "resp_2",
				text: "done",
				functionCalls: [],
				usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
			},
		]);
		const runner = new AgenticSearchRunner({
			llmAdapter: adapter as unknown as OpenAiResponsesAdapter,
			toolRegistry: createRegistryStub() as unknown as AgenticToolRegistry,
			options: {
				maxToolCalls: 5,
				maxFetchCalls: 2,
				maxContextChars: 5000,
			},
		});

		const result = await runner.run({
			query: "what is rag",
			topK: 8,
			systemContext: "context",
		});

		expect(result.answer).toBe("done");
		expect(result.toolTrace.length).toBe(1);
		expect(result.toolTrace[0]?.tool).toBe("search_evidence");
		expect(result.citations.length).toBe(1);
		expect(result.usage?.totalTokens).toBe(14);
		expect(adapter.calls.length).toBe(2);
		expect(adapter.calls[1]?.previousResponseId).toBe("resp_1");
	});
});
