import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmProviderExecutionError } from "./types";
import { CodexSdkProvider } from "./codexSdkProvider";

describe("CodexSdkProvider", () => {
	let tmpRoot: string;

	beforeEach(async () => {
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-provider-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpRoot, { recursive: true, force: true });
	});

	it("runs Codex with bounded read-only options and returns finalResponse", async () => {
		const run = vi.fn().mockResolvedValue({
			finalResponse: "done",
			usage: {
				input_tokens: 10,
				cached_input_tokens: 0,
				output_tokens: 4,
				reasoning_output_tokens: 0,
			},
		});
		const startThread = vi.fn().mockReturnValue({
			id: "thread-1",
			run,
		});
		const CodexMock = vi.fn(function () {
			return { startThread };
		});

		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			apiKey: "codex-key",
			codexHome: path.join(tmpRoot, "codex-home"),
			tmpRoot,
			env: {
				PATH: "/usr/bin",
				OPENAI_API_KEY: "must-not-leak",
			},
			reasoningEffort: "low",
			codexConstructor: CodexMock as any,
		});

		const response = await provider.chatCompletion([
			{ role: "system", content: "Return JSON only." },
			{ role: "user", content: "Review this." },
		]);

		expect(response).toEqual({
			id: "thread-1",
			content: "done",
			usage: {
				promptTokens: 10,
				completionTokens: 4,
				totalTokens: 14,
			},
		});
		expect(CodexMock).toHaveBeenCalledWith({
			apiKey: "codex-key",
			env: expect.objectContaining({
				PATH: "/usr/bin",
				CODEX_HOME: path.join(tmpRoot, "codex-home"),
				CODEX_API_KEY: "codex-key",
			}),
		});
		const codexCalls = CodexMock.mock.calls as unknown as [
			[{ env: Record<string, string> }],
		];
		const codexOptions = codexCalls[0]?.[0] as
			| { env: Record<string, string> }
			| undefined;
		expect(codexOptions?.env.OPENAI_API_KEY).toBeUndefined();
		expect(startThread).toHaveBeenCalledWith(
			expect.objectContaining({
				model: "gpt-5.4-mini",
				modelReasoningEffort: "low",
				sandboxMode: "read-only",
				approvalPolicy: "never",
				webSearchMode: "disabled",
				networkAccessEnabled: false,
				skipGitRepoCheck: true,
			}),
		);
		const threadOptions = startThread.mock.calls[0][0];
		expect(threadOptions.workingDirectory).toContain(tmpRoot);
		expect(run).toHaveBeenCalledWith(
			expect.stringContaining("### SYSTEM\nReturn JSON only."),
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("passes structured output schema to Codex turns", async () => {
		const outputSchema = {
			type: "object",
			properties: { summary: { type: "string" } },
			required: ["summary"],
		};
		const run = vi.fn().mockResolvedValue({
			finalResponse: `{"summary":"done"}`,
			usage: null,
		});
		const startThread = vi.fn().mockReturnValue({
			id: "thread-schema",
			run,
		});
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			tmpRoot,
			codexConstructor: vi.fn(function () {
				return { startThread };
			}) as any,
		});

		await provider.chatCompletion([{ role: "user", content: "hello" }], {
			outputSchema,
		});

		expect(run).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ outputSchema }),
		);
	});

	it("maps OPENAI_API_KEY from the environment to Codex's API key without leaking the original name", async () => {
		const startThread = vi.fn().mockReturnValue({
			id: "thread-env",
			run: vi.fn().mockResolvedValue({
				finalResponse: "done",
				usage: null,
			}),
		});
		const CodexMock = vi.fn(function () {
			return { startThread };
		});
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			apiKey: "   ",
			codexHome: path.join(tmpRoot, "codex-home"),
			tmpRoot,
			env: {
				PATH: "/usr/bin",
				CODEX_API_KEY: "\t",
				OPENAI_API_KEY: "openai-env-key",
			},
			codexConstructor: CodexMock as any,
		});

		await provider.chatCompletion([{ role: "user", content: "hello" }]);

		const codexCalls = CodexMock.mock.calls as unknown as [
			[{ env: Record<string, string>; apiKey?: string }],
		];
		const codexOptions = codexCalls[0]?.[0];
		expect(codexOptions?.apiKey).toBeUndefined();
		expect(codexOptions?.env.CODEX_API_KEY).toBe("openai-env-key");
		expect(codexOptions?.env.OPENAI_API_KEY).toBeUndefined();
		expect(provider.getDiagnostics().authSource).toBe("environment");
	});

	it("maps empty final responses to provider execution errors", async () => {
		const startThread = vi.fn().mockReturnValue({
			id: "thread-empty",
			run: vi.fn().mockResolvedValue({
				finalResponse: "",
				usage: null,
			}),
		});
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			tmpRoot,
			codexConstructor: vi.fn(function () {
				return { startThread };
			}) as any,
		});

		await expect(
			provider.chatCompletion([{ role: "user", content: "hello" }]),
		).rejects.toBeInstanceOf(LlmProviderExecutionError);
	});

	it("reports working directory setup failures as provider errors", async () => {
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			createWorkingDirectory: async () => {
				throw new Error("host path must not leak");
			},
		});

		await expect(
			provider.chatCompletion([{ role: "user", content: "hello" }]),
		).rejects.toMatchObject({
			name: "LlmProviderExecutionError",
			message: "Codex SDK working directory setup failed.",
			details: {
				code: "codex_working_directory_setup_failed",
			},
		});
	});

	it("never cleans up an unowned working directory returned by a test hook", async () => {
		let removerCalled = false;
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			tmpRoot,
			createWorkingDirectory: async () => tmpRoot,
			removeWorkingDirectory: async () => {
				removerCalled = true;
			},
		});

		await expect(
			provider.chatCompletion([{ role: "user", content: "hello" }]),
		).rejects.toMatchObject({
			message: "Codex SDK working directory setup failed.",
		});
		expect(removerCalled).toBe(false);
		await fs.access(tmpRoot);
	});

	it("reports working directory cleanup failures as provider errors", async () => {
		let workingDirectory = "";
		const startThread = vi.fn().mockReturnValue({
			id: "thread-cleanup",
			run: vi.fn().mockResolvedValue({
				finalResponse: "done",
				usage: null,
			}),
		});
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			tmpRoot,
			createWorkingDirectory: async () => {
				workingDirectory = await fs.mkdtemp(
					path.join(tmpRoot, "vuln-workbench-codex-cleanup-failure-"),
				);
				return workingDirectory;
			},
			removeWorkingDirectory: async () => {
				// Simulate a cleanup implementation that silently leaves the directory.
			},
			codexConstructor: vi.fn(function () {
				return { startThread };
			}) as any,
		});

		await expect(
			provider.chatCompletion([{ role: "user", content: "hello" }]),
		).rejects.toMatchObject({
			name: "LlmProviderExecutionError",
			message: "Codex SDK working directory cleanup failed.",
			details: {
				code: "codex_working_directory_cleanup_failed",
			},
		});
	});

	it("marks Codex home authentication as unverified in synchronous diagnostics", () => {
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			codexHome: path.join(tmpRoot, "codex-home"),
			env: {},
		});

		expect(provider.getDiagnostics().authSource).toBe(
			"codex-home-unverified",
		);
	});

	it("wraps SDK failures as provider execution errors", async () => {
		const startThread = vi.fn().mockReturnValue({
			id: "thread-failed",
			run: vi.fn().mockRejectedValue(new Error("codex failed")),
		});
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			tmpRoot,
			codexConstructor: vi.fn(function () {
				return { startThread };
			}) as any,
		});

		await expect(
			provider.chatCompletion([{ role: "user", content: "hello" }]),
		).rejects.toMatchObject({
			name: "LlmProviderExecutionError",
			message: "codex failed",
		});
	});

	it("reports provider timeouts explicitly", async () => {
		const startThread = vi.fn().mockReturnValue({
			id: "thread-timeout",
			run: vi.fn(
				(_prompt: string, options: { signal?: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						options.signal?.addEventListener("abort", () => {
							reject(new Error("The operation was aborted."));
						});
					}),
			),
		});
		const provider = new CodexSdkProvider({
			model: "gpt-5.4-mini",
			tmpRoot,
			timeoutMs: 1,
			codexConstructor: vi.fn(function () {
				return { startThread };
			}) as any,
		});

		await expect(
			provider.chatCompletion([{ role: "user", content: "hello" }]),
		).rejects.toMatchObject({
			name: "LlmProviderExecutionError",
			message: "Codex SDK timed out after 1ms.",
		});
	});
});
