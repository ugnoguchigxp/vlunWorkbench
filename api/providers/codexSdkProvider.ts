import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	Codex,
	type CodexOptions,
	type ModelReasoningEffort,
	type ThreadOptions,
} from "@openai/codex-sdk";
import type { ChatMessage } from "../types/llm";
import {
	LlmProviderExecutionError,
	type LlmCompletionOptions,
	type LlmProvider,
	type LlmResponse,
} from "./types";

type CodexLike = Pick<Codex, "startThread">;
type CodexConstructor = new (options?: CodexOptions) => CodexLike;

export type CodexSdkProviderDiagnostics = {
	sdkAvailable: boolean;
	runtimeMode: "bun-direct";
	codexHome: string;
	authSource: "api-key" | "codex-home" | "environment" | "none";
	model: string;
	timeoutMs: number;
	reasoningEffort: ModelReasoningEffort | null;
};

export type CodexSdkProviderConfig = {
	model: string;
	apiKey?: string;
	codexHome?: string;
	timeoutMs?: number;
	reasoningEffort?: ModelReasoningEffort;
	codexConstructor?: CodexConstructor;
	tmpRoot?: string;
	env?: NodeJS.ProcessEnv;
};

const DEFAULT_TIMEOUT_MS = 600_000;

function safeEnv(
	env: NodeJS.ProcessEnv,
	params: { codexHome: string; apiKey?: string },
): Record<string, string> {
	const next: Record<string, string> = {};
	const copyKeys = [
		"PATH",
		"HOME",
		"USER",
		"LOGNAME",
		"SHELL",
		"TMPDIR",
		"TEMP",
		"TMP",
		"NODE_EXTRA_CA_CERTS",
		"SSL_CERT_FILE",
		"SSL_CERT_DIR",
	];
	for (const key of copyKeys) {
		const value = env[key];
		if (value) next[key] = value;
	}
	next.CODEX_HOME = params.codexHome;
	if (params.apiKey) {
		next.CODEX_API_KEY = params.apiKey;
	} else if (env.CODEX_API_KEY) {
		next.CODEX_API_KEY = env.CODEX_API_KEY;
	} else if (env.OPENAI_API_KEY) {
		next.CODEX_API_KEY = env.OPENAI_API_KEY;
	}
	return next;
}

function envSnapshot(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const keys = [
		"PATH",
		"HOME",
		"USER",
		"LOGNAME",
		"SHELL",
		"TMPDIR",
		"TEMP",
		"TMP",
		"NODE_EXTRA_CA_CERTS",
		"SSL_CERT_FILE",
		"SSL_CERT_DIR",
		"CODEX_HOME",
		"CODEX_API_KEY",
		"OPENAI_API_KEY",
	];
	const next: NodeJS.ProcessEnv = {};
	for (const key of keys) {
		const value = env[key];
		if (value) next[key] = value;
	}
	return next;
}

function formatMessages(messages: ChatMessage[]): string {
	return messages
		.map((message) => {
			const role = message.role.toUpperCase();
			return `### ${role}\n${message.content}`;
		})
		.join("\n\n");
}

function usageFromCodex(
	usage: {
		input_tokens: number;
		output_tokens: number;
		cached_input_tokens: number;
		reasoning_output_tokens: number;
	} | null,
): LlmResponse["usage"] {
	if (!usage) return undefined;
	return {
		promptTokens: usage.input_tokens,
		completionTokens: usage.output_tokens,
		totalTokens: usage.input_tokens + usage.output_tokens,
	};
}

function authSource(params: {
	apiKey?: string;
	codexHome: string;
	env: NodeJS.ProcessEnv;
}): CodexSdkProviderDiagnostics["authSource"] {
	if (params.apiKey) return "api-key";
	if (params.env.CODEX_API_KEY || params.env.OPENAI_API_KEY)
		return "environment";
	if (params.codexHome) return "codex-home";
	return "none";
}

export class CodexSdkProvider implements LlmProvider {
	private readonly codexHome: string;
	private readonly timeoutMs: number;
	private readonly codexConstructor: CodexConstructor;
	private readonly tmpRoot: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly model: string;
	private readonly apiKey?: string;
	private readonly reasoningEffort?: ModelReasoningEffort;

	constructor(config: CodexSdkProviderConfig) {
		this.model = config.model;
		this.apiKey = config.apiKey;
		this.reasoningEffort = config.reasoningEffort;
		this.codexHome =
			config.codexHome ??
			config.env?.CODEX_HOME ??
			path.join(os.homedir(), ".codex");
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.codexConstructor = config.codexConstructor ?? Codex;
		this.tmpRoot = config.tmpRoot ?? os.tmpdir();
		this.env = envSnapshot(config.env ?? process.env);
	}

	getDiagnostics(): CodexSdkProviderDiagnostics {
		return {
			sdkAvailable: true,
			runtimeMode: "bun-direct",
			codexHome: this.codexHome,
			authSource: authSource({
				apiKey: this.apiKey,
				codexHome: this.codexHome,
				env: this.env,
			}),
			model: this.model,
			timeoutMs: this.timeoutMs,
			reasoningEffort: this.reasoningEffort ?? null,
		};
	}

	async chatCompletion(
		messages: ChatMessage[],
		options?: LlmCompletionOptions,
	): Promise<LlmResponse> {
		const workingDirectory = await fs.mkdtemp(
			path.join(this.tmpRoot, "vuln-workbench-codex-"),
		);
		const controller = new AbortController();
		let didTimeout = false;
		const timeout = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, this.timeoutMs);
		try {
			const codex = new this.codexConstructor({
				apiKey: this.apiKey,
				env: safeEnv(this.env, {
					apiKey: this.apiKey,
					codexHome: this.codexHome,
				}),
			});
			const threadOptions: ThreadOptions = {
				model: this.model,
				...(this.reasoningEffort
					? { modelReasoningEffort: this.reasoningEffort }
					: {}),
				sandboxMode: "read-only",
				approvalPolicy: "never",
				webSearchMode: "disabled",
				networkAccessEnabled: false,
				workingDirectory,
				skipGitRepoCheck: true,
			};
			const thread = codex.startThread(threadOptions);
			const result = await thread.run(formatMessages(messages), {
				...(options?.outputSchema
					? { outputSchema: options.outputSchema }
					: {}),
				signal: controller.signal,
			});
			const content = result.finalResponse?.trim();
			if (!content) {
				throw new LlmProviderExecutionError(
					"Codex SDK returned an empty final response.",
					{ model: this.model },
				);
			}
			return {
				id: thread.id ?? crypto.randomUUID(),
				content,
				usage: usageFromCodex(result.usage),
			};
		} catch (error) {
			if (error instanceof LlmProviderExecutionError) throw error;
			if (didTimeout) {
				throw new LlmProviderExecutionError(
					`Codex SDK timed out after ${this.timeoutMs}ms.`,
					{
						model: this.model,
						runtimeMode: "bun-direct",
					},
				);
			}
			const message =
				error instanceof Error
					? error.message
					: `Codex SDK failed: ${String(error)}`;
			throw new LlmProviderExecutionError(message, {
				model: this.model,
				runtimeMode: "bun-direct",
			});
		} finally {
			clearTimeout(timeout);
			await fs.rm(workingDirectory, { recursive: true, force: true });
		}
	}
}
