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
	authSource: "api-key" | "codex-home-unverified" | "environment" | "none";
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
	createWorkingDirectory?: () => Promise<string>;
	removeWorkingDirectory?: (workingDirectory: string) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 600_000;
const WORKING_DIRECTORY_PREFIX = "vuln-workbench-codex-";

function normalizedNonEmptyString(
	value: string | undefined,
): string | undefined {
	const normalized = value?.trim();
	return normalized || undefined;
}

function isOwnedTemporaryPath(
	candidate: string,
	parent: string,
	prefix: string,
): boolean {
	const resolvedCandidate = path.resolve(candidate);
	const resolvedParent = path.resolve(parent);
	const basename = path.basename(resolvedCandidate);
	return (
		path.dirname(resolvedCandidate) === resolvedParent &&
		basename.startsWith(prefix) &&
		basename.length > prefix.length
	);
}

async function pathWasRemoved(candidate: string): Promise<boolean> {
	try {
		await fs.lstat(candidate);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT";
	}
}

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
	const apiKey =
		normalizedNonEmptyString(params.apiKey) ??
		normalizedNonEmptyString(env.CODEX_API_KEY) ??
		normalizedNonEmptyString(env.OPENAI_API_KEY);
	if (apiKey) {
		next.CODEX_API_KEY = apiKey;
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
	if (normalizedNonEmptyString(params.apiKey)) return "api-key";
	if (
		normalizedNonEmptyString(params.env.CODEX_API_KEY) ||
		normalizedNonEmptyString(params.env.OPENAI_API_KEY)
	)
		return "environment";
	if (params.codexHome) return "codex-home-unverified";
	return "none";
}

function executionError(
	error: unknown,
	params: { didTimeout: boolean; timeoutMs: number; model: string },
): LlmProviderExecutionError {
	if (error instanceof LlmProviderExecutionError) return error;
	if (params.didTimeout) {
		return new LlmProviderExecutionError(
			`Codex SDK timed out after ${params.timeoutMs}ms.`,
			{
				model: params.model,
				runtimeMode: "bun-direct",
			},
		);
	}
	const message =
		error instanceof Error
			? error.message
			: `Codex SDK failed: ${String(error)}`;
	return new LlmProviderExecutionError(message, {
		model: params.model,
		runtimeMode: "bun-direct",
	});
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
	private readonly createWorkingDirectory: () => Promise<string>;
	private readonly removeWorkingDirectory: (
		workingDirectory: string,
	) => Promise<void>;

	constructor(config: CodexSdkProviderConfig) {
		this.model = config.model;
		this.apiKey = normalizedNonEmptyString(config.apiKey);
		this.reasoningEffort = config.reasoningEffort;
		this.codexHome =
			normalizedNonEmptyString(config.codexHome) ??
			normalizedNonEmptyString(config.env?.CODEX_HOME) ??
			path.join(os.homedir(), ".codex");
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.codexConstructor = config.codexConstructor ?? Codex;
		this.tmpRoot = config.tmpRoot ?? os.tmpdir();
		this.env = envSnapshot(config.env ?? process.env);
		this.createWorkingDirectory =
			config.createWorkingDirectory ??
			(() => fs.mkdtemp(path.join(this.tmpRoot, WORKING_DIRECTORY_PREFIX)));
		this.removeWorkingDirectory =
			config.removeWorkingDirectory ??
			((workingDirectory) =>
				fs.rm(workingDirectory, { recursive: true, force: true }));
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
		let workingDirectory: string;
		try {
			workingDirectory = await this.createWorkingDirectory();
			if (
				!isOwnedTemporaryPath(
					workingDirectory,
					this.tmpRoot,
					WORKING_DIRECTORY_PREFIX,
				)
			) {
				throw new Error("Unowned Codex working directory.");
			}
		} catch {
			throw new LlmProviderExecutionError(
				"Codex SDK working directory setup failed.",
				{
					code: "codex_working_directory_setup_failed",
					model: this.model,
					runtimeMode: "bun-direct",
				},
			);
		}
		const controller = new AbortController();
		let didTimeout = false;
		const timeout = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, this.timeoutMs);
		let outcome:
			| { ok: true; response: LlmResponse }
			| { ok: false; error: LlmProviderExecutionError };
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
			outcome = {
				ok: true,
				response: {
					id: thread.id ?? crypto.randomUUID(),
					content,
					usage: usageFromCodex(result.usage),
				},
			};
		} catch (error) {
			outcome = {
				ok: false,
				error: executionError(error, {
					didTimeout,
					timeoutMs: this.timeoutMs,
					model: this.model,
				}),
			};
		}
		clearTimeout(timeout);

		try {
			await this.removeWorkingDirectory(workingDirectory);
			if (!(await pathWasRemoved(workingDirectory))) {
				throw new Error("Codex working directory still exists.");
			}
		} catch {
			throw new LlmProviderExecutionError(
				"Codex SDK working directory cleanup failed.",
				{
					code: "codex_working_directory_cleanup_failed",
					model: this.model,
					runtimeMode: "bun-direct",
				},
			);
		}

		if (!outcome.ok) throw outcome.error;
		return outcome.response;
	}
}
