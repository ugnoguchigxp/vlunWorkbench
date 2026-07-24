import { describe, expect, test } from "bun:test";
import type { LlmProvider } from "../providers/types";
import {
	bindChatDirectAnswerSystemContext,
	bindFindingReviewUserMessage,
} from "./bindings";
import {
	executeLlmCompletion,
	executePromptCompletion,
} from "./llm-execution";

describe("executeLlmCompletion", () => {
	test("submits exactly one leading system message and returns its manifest", async () => {
		const calls: Parameters<LlmProvider["chatCompletion"]>[0][] = [];
		const provider: LlmProvider = {
			async chatCompletion(messages) {
				calls.push(messages);
				return { id: "response-1", content: "ok" };
			},
		};
		const invocation = bindChatDirectAnswerSystemContext();

		const result = await executeLlmCompletion({
			provider,
			systemContext: invocation,
			messages: [{ role: "user", content: "hello" }],
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.map((message) => message.role)).toEqual([
			"system",
			"user",
		]);
		expect(result.systemContextManifest).toEqual(invocation.manifest);
		expect(result.promptMessageManifests).toEqual([invocation.manifest]);
		expect(result.promptSequenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	test("submits authored system and user roles and records their sequence", async () => {
		const calls: Parameters<LlmProvider["chatCompletion"]>[0][] = [];
		const provider: LlmProvider = {
			async chatCompletion(messages) {
				calls.push(messages);
				return { id: "response-1", content: "ok" };
			},
		};
		const system = bindChatDirectAnswerSystemContext();
		const user = bindFindingReviewUserMessage({
			finding: {
				id: "finding-1",
				sourceTool: "semgrep",
				ruleId: "rule-1",
				title: "Finding",
				description: "Description",
				severity: "high",
				confidence: "high",
				status: "open",
				primaryLocation: null,
			},
			scanContext: {
				scanRunId: "scan-1",
				profile: "default",
				toolName: "semgrep",
				toolVersion: "1.0.0",
				command: "semgrep",
			},
			evidences: [],
			sourceSnippet: "line 1\nline 2",
		});

		const result = await executePromptCompletion({
			provider,
			promptMessages: [system, user],
		});

		expect(calls[0]?.map((message) => message.role)).toEqual([
			"system",
			"user",
		]);
		expect(result.promptMessageManifests).toEqual([
			system.manifest,
			user.manifest,
		]);
		expect(result.promptSequenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	test("rejects a modified rendered context before provider execution", async () => {
		let called = false;
		const provider: LlmProvider = {
			async chatCompletion() {
				called = true;
				return { id: "response-1", content: "ok" };
			},
		};
		const invocation = bindChatDirectAnswerSystemContext();
		const modified = {
			...invocation,
			content: { ...invocation.content, text: `${invocation.content.text}!` },
		};

		await expect(
			executeLlmCompletion({
				provider,
				systemContext: modified,
				messages: [{ role: "user", content: "hello" }],
			}),
		).rejects.toThrow("rendered hash mismatch");
		expect(called).toBe(false);
	});

	test("rejects a role modified after rendering", async () => {
		const provider: LlmProvider = {
			async chatCompletion() {
				return { id: "response-1", content: "ok" };
			},
		};
		const invocation = bindChatDirectAnswerSystemContext();

		await expect(
			executePromptCompletion({
				provider,
				promptMessages: [{ ...invocation, role: "user" }],
			}),
		).rejects.toThrow("role mismatch");
	});
});
