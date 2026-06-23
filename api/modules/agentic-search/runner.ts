import type { AgenticSearchCitation, AgenticSearchResult } from "./types";
import type { OpenAiResponsesAdapter } from "./llm/openai-responses-adapter";
import type {
	AgenticSearchRequest,
	AgenticSearchRunOptions,
	AgenticToolTrace,
	AgenticUsage,
} from "./types";
import type { AgenticToolRegistry } from "./tools/registry";
import type { EvidenceWebResult } from "../rag/search-evidence";
import type { RetrievedFragment } from "../rag/types";

type AgenticSearchRunnerDeps = {
	llmAdapter: OpenAiResponsesAdapter;
	toolRegistry: AgenticToolRegistry;
	options: AgenticSearchRunOptions;
	debug?: boolean;
	log?: (params: {
		level: "info" | "debug" | "warn" | "error";
		event: string;
		data?: Record<string, unknown>;
	}) => void;
};

function mergeUsage(
	acc: AgenticUsage | undefined,
	next: AgenticUsage | undefined,
): AgenticUsage | undefined {
	if (!next) return acc;
	if (!acc) return { ...next };
	return {
		inputTokens: acc.inputTokens + next.inputTokens,
		outputTokens: acc.outputTokens + next.outputTokens,
		totalTokens: acc.totalTokens + next.totalTokens,
	};
}

function dedupeCitations(
	citations: AgenticSearchCitation[],
): AgenticSearchCitation[] {
	const rankCitation = (citation: AgenticSearchCitation): number => {
		if (citation.kind === "wiki_page" || citation.kind === "web_page") return 2;
		return 1;
	};
	const sourceKey = (citation: AgenticSearchCitation): string =>
		citation.wikiSlug
			? `wiki:${citation.wikiSlug}`
			: citation.url
				? `url:${citation.url}`
				: citation.uri
					? `uri:${citation.uri}`
					: `title:${citation.kind}:${citation.title}`;
	const result: AgenticSearchCitation[] = [];
	for (const citation of citations) {
		const key = sourceKey(citation);
		const existingIndex = result.findIndex((item) => sourceKey(item) === key);
		if (existingIndex >= 0) {
			const existing = result[existingIndex];
			if (existing && rankCitation(citation) > rankCitation(existing)) {
				result[existingIndex] = citation;
			}
			continue;
		}
		result.push(citation);
	}
	return result;
}

function parseArguments(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

export class AgenticSearchRunner {
	private readonly llmAdapter: OpenAiResponsesAdapter;
	private readonly toolRegistry: AgenticToolRegistry;
	private readonly options: AgenticSearchRunOptions;
	private readonly debug: boolean;
	private readonly logHandler?: AgenticSearchRunnerDeps["log"];

	constructor(deps: AgenticSearchRunnerDeps) {
		this.llmAdapter = deps.llmAdapter;
		this.toolRegistry = deps.toolRegistry;
		this.options = deps.options;
		this.debug = Boolean(deps.debug);
		this.logHandler = deps.log;
	}

	private log(
		level: "info" | "debug" | "warn" | "error",
		event: string,
		data?: Record<string, unknown>,
	): void {
		if (level === "debug" && !this.debug) return;
		if (this.logHandler) {
			this.logHandler({ level, event, data });
			return;
		}
		const payload = data ? ` ${JSON.stringify(data)}` : "";
		if (level === "error") {
			console.error(`[agentic-search][runner] ${event}${payload}`);
			return;
		}
		console.log(`[agentic-search][runner] ${event}${payload}`);
	}

	async run(request: AgenticSearchRequest): Promise<AgenticSearchResult> {
		const startedAt = Date.now();
		let previousResponseId: string | undefined;
		let pendingInput: unknown[] = [
			{
				role: "user",
				content: [{ type: "input_text", text: request.query }],
			},
		];
		let fetchCount = 0;
		let executedToolCalls = 0;
		let usage: AgenticUsage | undefined;
		const citations: AgenticSearchCitation[] = [];
		const toolTrace: AgenticToolTrace[] = [];
		const retrieved: RetrievedFragment[] = [];
		const webResults: EvidenceWebResult[] = [];

		const maxTurns = this.options.maxToolCalls + 8;
		this.log("info", "run.start", {
			queryLength: request.query.length,
			category: request.category ?? null,
			topK: request.topK,
			maxTurns,
			maxToolCalls: this.options.maxToolCalls,
			maxFetchCalls: this.options.maxFetchCalls,
		});

		for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
			this.log("debug", "turn.start", {
				turn: turnIndex + 1,
				previousResponseId: previousResponseId ?? null,
				inputItems: pendingInput.length,
			});
			const turn = await this.llmAdapter.createTurn({
				instructions: request.systemContext,
				input: pendingInput,
				tools: this.toolRegistry.listSpecs(),
				previousResponseId,
			});
			usage = mergeUsage(usage, turn.usage);
			this.log("debug", "turn.completed", {
				turn: turnIndex + 1,
				responseId: turn.responseId,
				functionCalls: turn.functionCalls.length,
				textLength: turn.text.length,
			});

			if (turn.functionCalls.length === 0) {
				const answer = turn.text.trim();
				this.log("info", "run.complete", {
					turns: turnIndex + 1,
					toolCalls: executedToolCalls,
					citations: citations.length,
					answerLength: answer.length,
					elapsedMs: Date.now() - startedAt,
				});
				return {
					query: request.query,
					answer:
						answer ||
						"回答を生成できませんでした。質問を具体化して再実行してください。",
					citations: dedupeCitations(citations),
					toolTrace,
					retrieved: retrieved.length > 0 ? retrieved : undefined,
					webResults: webResults.length > 0 ? webResults : undefined,
					usage,
				};
			}

			const functionOutputs: unknown[] = [];
			for (const call of turn.functionCalls) {
				if (!this.toolRegistry.has(call.name)) {
					toolTrace.push({
						tool: call.name,
						status: "skipped",
						elapsedMs: 0,
						message: "Unknown tool.",
						turn: turnIndex + 1,
						callId: call.callId,
					});
					functionOutputs.push({
						type: "function_call_output",
						call_id: call.callId,
						output: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
					});
					continue;
				}

				if (call.name === "fetch" && fetchCount >= this.options.maxFetchCalls) {
					toolTrace.push({
						tool: call.name,
						status: "skipped",
						elapsedMs: 0,
						message: "Fetch tool budget reached.",
						turn: turnIndex + 1,
						callId: call.callId,
					});
					functionOutputs.push({
						type: "function_call_output",
						call_id: call.callId,
						output: JSON.stringify({ error: "Fetch tool budget reached." }),
					});
					continue;
				}

				if (executedToolCalls >= this.options.maxToolCalls) {
					toolTrace.push({
						tool: call.name,
						status: "skipped",
						elapsedMs: 0,
						message: "Tool call budget reached.",
						turn: turnIndex + 1,
						callId: call.callId,
					});
					functionOutputs.push({
						type: "function_call_output",
						call_id: call.callId,
						output: JSON.stringify({ error: "Tool call budget reached." }),
					});
					continue;
				}

				const args = parseArguments(call.argumentsJson);
				const startAt = Date.now();
				this.log("debug", "tool.start", {
					turn: turnIndex + 1,
					callId: call.callId,
					tool: call.name,
				});
				try {
					const execution = await this.toolRegistry.execute(call.name, args, {
						query: request.query,
						category: request.category,
						topK: request.topK,
						fetchCount,
						maxFetchCalls: this.options.maxFetchCalls,
						maxContextChars: this.options.maxContextChars,
					});
					executedToolCalls += 1;
					if (call.name === "fetch") {
						fetchCount += 1;
					}
					toolTrace.push({
						tool: call.name,
						status: "ok",
						elapsedMs: Date.now() - startAt,
						resultCount: execution.resultCount,
						turn: turnIndex + 1,
						callId: call.callId,
					});
					this.log("debug", "tool.complete", {
						turn: turnIndex + 1,
						callId: call.callId,
						tool: call.name,
						elapsedMs: Date.now() - startAt,
						resultCount: execution.resultCount ?? 0,
					});
					if (execution.citations && execution.citations.length > 0) {
						citations.push(...execution.citations);
					}
					if (execution.retrieved && execution.retrieved.length > 0) {
						retrieved.push(...execution.retrieved);
					}
					if (execution.webResults && execution.webResults.length > 0) {
						webResults.push(...execution.webResults);
					}
					functionOutputs.push({
						type: "function_call_output",
						call_id: call.callId,
						output: JSON.stringify(execution.output),
					});
				} catch (error) {
					toolTrace.push({
						tool: call.name,
						status: "error",
						elapsedMs: Date.now() - startAt,
						message:
							error instanceof Error ? error.message : "Tool execution failed.",
						turn: turnIndex + 1,
						callId: call.callId,
					});
					this.log("warn", "tool.error", {
						turn: turnIndex + 1,
						callId: call.callId,
						tool: call.name,
						elapsedMs: Date.now() - startAt,
						message:
							error instanceof Error ? error.message : "Tool execution failed.",
					});
					functionOutputs.push({
						type: "function_call_output",
						call_id: call.callId,
						output: JSON.stringify({
							error:
								error instanceof Error
									? error.message
									: "Tool execution failed.",
						}),
					});
				}
			}

			previousResponseId = turn.responseId;
			pendingInput = functionOutputs;
		}

		this.log("warn", "run.max_turns_reached", {
			maxTurns,
			toolCalls: executedToolCalls,
			citations: citations.length,
			elapsedMs: Date.now() - startedAt,
		});
		return {
			query: request.query,
			answer:
				"Agentic Search のツール実行上限に達したため、回答を完了できませんでした。質問範囲を絞って再実行してください。",
			citations: dedupeCitations(citations),
			toolTrace,
			retrieved: retrieved.length > 0 ? retrieved : undefined,
			webResults: webResults.length > 0 ? webResults : undefined,
			usage,
		};
	}
}
