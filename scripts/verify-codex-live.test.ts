import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { CodexSdkProviderConfig } from "../api/providers/codexSdkProvider";
import {
	CODEX_LIVE_MARKER,
	CodexLiveVerificationError,
	parseCodexLiveArgs,
	verifyCodexLive,
} from "./verify-codex-live";

const liveEnv = {
	VULN_WORKBENCH_CODEX_LIVE: "1",
	OPENAI_API_KEY: "test-live-secret",
	PATH: process.env.PATH,
};

describe("verifyCodexLive", () => {
	test("fails before provider construction without explicit opt-in", async () => {
		let providerCreated = false;
		await expect(
			verifyCodexLive(
				{ model: "test-model", env: { OPENAI_API_KEY: "test-key" } },
				{
					providerFactory: () => {
						providerCreated = true;
						throw new Error("must not run");
					},
				},
			),
		).rejects.toMatchObject({
			code: "live_opt_in_required",
		});
		expect(providerCreated).toBe(false);
	});

	test("requires an API key instead of reusing a personal Codex cache", async () => {
		await expect(
			verifyCodexLive({
				model: "test-model",
				env: { VULN_WORKBENCH_CODEX_LIVE: "1" },
			}),
		).rejects.toMatchObject({ code: "credentials_missing" });
	});

	test("classifies isolated runtime creation failures", async () => {
		await expect(
			verifyCodexLive(
				{ model: "test-model", env: liveEnv },
				{
					createRuntimeRoot: async () => {
						throw new Error("host path must not leak");
					},
				},
			),
		).rejects.toMatchObject({
			code: "runtime_setup_failed",
			message: "Failed to create the isolated Codex runtime.",
		});
	});

	test("never cleans up an unowned runtime returned by a test hook", async () => {
		let removerCalled = false;
		await expect(
			verifyCodexLive(
				{ model: "test-model", env: liveEnv },
				{
					createRuntimeRoot: async () => os.tmpdir(),
					removeRuntimeRoot: async () => {
						removerCalled = true;
					},
				},
			),
		).rejects.toMatchObject({
			code: "runtime_setup_failed",
			message: "Failed to create the isolated Codex runtime.",
		});
		expect(removerCalled).toBe(false);
	});

	test("classifies isolated runtime preparation failures and cleans up", async () => {
		const filePath = path.join(
			os.tmpdir(),
			`vuln-workbench-codex-live-${crypto.randomUUID()}`,
		);
		await fs.writeFile(filePath, "fixture");
		try {
			await expect(
				verifyCodexLive(
					{ model: "test-model", env: liveEnv },
					{ createRuntimeRoot: async () => filePath },
				),
			).rejects.toMatchObject({
				code: "runtime_setup_failed",
				message: "Failed to prepare the isolated Codex runtime.",
			});
			await expect(fs.access(filePath)).rejects.toThrow();
		} finally {
			try {
				await fs.unlink(filePath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	});

	test("falls back from a blank CODEX_API_KEY to OPENAI_API_KEY", async () => {
		let apiKey = "";
		await verifyCodexLive(
			{
				model: "test-model",
				env: {
					...liveEnv,
					CODEX_API_KEY: " ",
					OPENAI_API_KEY: "openai-fallback-key",
				},
			},
			{
				providerFactory: (config) => {
					apiKey = config.apiKey ?? "";
					return {
						chatCompletion: async () => ({
							id: "fallback-response",
							content: JSON.stringify({
								ok: true,
								marker: CODEX_LIVE_MARKER,
							}),
						}),
					};
				},
			},
		);

		expect(apiKey).toBe("openai-fallback-key");
	});

	test("validates structured output and removes the isolated runtime", async () => {
		let providerConfig: CodexSdkProviderConfig | null = null;
		let receivedOptions: unknown;
		const ticks = [100, 145];

		const result = await verifyCodexLive(
			{ model: "test-model", timeoutMs: 4_000, env: liveEnv },
			{
				now: () => ticks.shift() ?? 145,
				providerFactory: (config) => {
					providerConfig = config;
					return {
						chatCompletion: async (_messages, options) => {
							receivedOptions = options;
							return {
								id: "live-contract-response",
								content: JSON.stringify({
									ok: true,
									marker: CODEX_LIVE_MARKER,
								}),
								usage: {
									promptTokens: 8,
									completionTokens: 4,
									totalTokens: 12,
								},
							};
						},
					};
				},
			},
		);

		expect(result).toEqual({
			ok: true,
			status: "passed",
			model: "test-model",
			runtimeMode: "bun-direct",
			durationMs: 45,
			threadId: "live-contract-response",
			usage: {
				promptTokens: 8,
				completionTokens: 4,
				totalTokens: 12,
			},
			outputValidated: true,
		});
		expect(receivedOptions).toEqual({
			outputSchema: {
				type: "object",
				properties: {
					ok: { type: "boolean", enum: [true] },
					marker: { type: "string", enum: [CODEX_LIVE_MARKER] },
				},
				required: ["ok", "marker"],
				additionalProperties: false,
			},
		});
		expect(providerConfig).toMatchObject({
			model: "test-model",
			apiKey: "test-live-secret",
			timeoutMs: 4_000,
			reasoningEffort: "low",
		});
		const capturedConfig = providerConfig as CodexSdkProviderConfig | null;
		expect(capturedConfig?.env?.HOME).not.toBe(process.env.HOME);
		expect(capturedConfig?.codexHome).toContain("vuln-workbench-codex-live-");
		await expect(fs.access(capturedConfig?.tmpRoot ?? "")).rejects.toThrow();
		expect("content" in result).toBe(false);
	});

	test("reports isolated runtime cleanup failures explicitly", async () => {
		let runtimeRoot = "";
		try {
			await expect(
				verifyCodexLive(
					{ model: "test-model", env: liveEnv },
					{
						providerFactory: (config) => {
							runtimeRoot = config.tmpRoot ?? "";
							return {
								chatCompletion: async () => ({
									id: "cleanup-response",
									content: JSON.stringify({
										ok: true,
										marker: CODEX_LIVE_MARKER,
									}),
								}),
							};
						},
						removeRuntimeRoot: async () => {
							// Simulate a cleanup implementation that silently leaves the runtime.
						},
					},
				),
			).rejects.toMatchObject({
				code: "cleanup_failed",
				message: "Failed to remove the isolated Codex runtime.",
			});
		} finally {
			if (runtimeRoot) {
				await fs.rm(runtimeRoot, { recursive: true, force: true });
			}
		}
	});

	test("redacts credentials and temporary paths from provider failures", async () => {
		let runtimeRoot = "";
		let failure: unknown;
		try {
			await verifyCodexLive(
				{ model: "test-model", env: liveEnv },
				{
					providerFactory: (config) => {
						runtimeRoot = config.tmpRoot ?? "";
						return {
							chatCompletion: async () => {
								throw new Error(
									`failure test-live-secret at ${runtimeRoot}`,
								);
							},
						};
					},
				},
			);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(CodexLiveVerificationError);
		expect(failure).toMatchObject({ code: "provider_execution_failed" });
		const message = failure instanceof Error ? failure.message : "";
		expect(message).not.toContain("test-live-secret");
		expect(message).not.toContain(runtimeRoot);
		expect(message).toContain("[redacted]");
		await expect(fs.access(runtimeRoot)).rejects.toThrow();
	});

	test("rejects invalid output and still removes the runtime", async () => {
		let runtimeRoot = "";
		await expect(
			verifyCodexLive(
				{ model: "test-model", env: liveEnv },
				{
					providerFactory: (config) => {
						runtimeRoot = config.tmpRoot ?? "";
						return {
							chatCompletion: async () => ({
								id: "invalid-response",
								content: `{"ok":false}`,
							}),
						};
					},
				},
			),
		).rejects.toMatchObject({ code: "response_invalid" });
		await expect(fs.access(runtimeRoot)).rejects.toThrow();
	});
});

describe("parseCodexLiveArgs", () => {
	test("parses model and timeout without enabling live execution", () => {
		expect(
			parseCodexLiveArgs([
				"--model",
				"test-model",
				"--timeout-ms",
				"9000",
			]),
		).toEqual({ help: false, model: "test-model", timeoutMs: 9_000 });
	});

	test("rejects unknown arguments", () => {
		const secretArgument = "--api-key=must-not-appear";
		let message = "";
		try {
			parseCodexLiveArgs([secretArgument]);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toBe("Unknown argument.");
		expect(message).not.toContain("must-not-appear");
	});

	test("rejects missing flag values before live execution", () => {
		expect(() =>
			parseCodexLiveArgs(["--model", "--timeout-ms", "9000"]),
		).toThrow("--model requires a value.");
		expect(() => parseCodexLiveArgs(["--timeout-ms", "1e3"])).toThrow(
			"--timeout-ms requires a decimal integer.",
		);
	});

	test("rejects duplicate value flags", () => {
		expect(() =>
			parseCodexLiveArgs(["--model", "first", "--model", "second"]),
		).toThrow("--model may only be specified once.");
		expect(() =>
			parseCodexLiveArgs([
				"--timeout-ms",
				"1000",
				"--timeout-ms",
				"2000",
			]),
		).toThrow("--timeout-ms may only be specified once.");
	});
});
