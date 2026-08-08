import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
	CodexSdkProvider,
	type CodexSdkProviderConfig,
} from "../api/providers/codexSdkProvider";
import type { LlmProvider, LlmResponse } from "../api/providers/types";

export const CODEX_LIVE_OPT_IN_ENV = "VULN_WORKBENCH_CODEX_LIVE";
export const CODEX_LIVE_MARKER = "vuln-workbench-codex-live";
export const DEFAULT_CODEX_LIVE_TIMEOUT_MS = 180_000;

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;
const RUNTIME_ROOT_PREFIX = "vuln-workbench-codex-live-";

const codexLiveOutputSchema = {
	type: "object",
	properties: {
		ok: { type: "boolean", enum: [true] },
		marker: { type: "string", enum: [CODEX_LIVE_MARKER] },
	},
	required: ["ok", "marker"],
	additionalProperties: false,
} as const;

const CodexLiveOutputSchema = z
	.object({
		ok: z.literal(true),
		marker: z.literal(CODEX_LIVE_MARKER),
	})
	.strict();

export type CodexLiveVerificationOptions = {
	model: string;
	timeoutMs?: number;
	env?: NodeJS.ProcessEnv;
};

export type CodexLiveVerificationResult = {
	ok: true;
	status: "passed";
	model: string;
	runtimeMode: "bun-direct";
	durationMs: number;
	threadId: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	} | null;
	outputValidated: true;
};

export type CodexLiveFailureCode =
	| "live_opt_in_required"
	| "model_required"
	| "credentials_missing"
	| "timeout_invalid"
	| "runtime_setup_failed"
	| "provider_execution_failed"
	| "response_invalid"
	| "cleanup_failed";

export class CodexLiveVerificationError extends Error {
	constructor(
		readonly code: CodexLiveFailureCode,
		message: string,
	) {
		super(message);
		this.name = "CodexLiveVerificationError";
	}
}

type ProviderFactory = (
	config: CodexSdkProviderConfig,
) => Pick<LlmProvider, "chatCompletion">;

export type CodexLiveVerificationDependencies = {
	providerFactory?: ProviderFactory;
	now?: () => number;
	createRuntimeRoot?: () => Promise<string>;
	removeRuntimeRoot?: (runtimeRoot: string) => Promise<void>;
};

export type CodexLiveCliArgs = {
	help: boolean;
	model: string;
	timeoutMs: number;
};

function requiredCredential(env: NodeJS.ProcessEnv): string {
	return env.CODEX_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || "";
}

function isOwnedRuntimeRoot(candidate: string): boolean {
	const resolvedCandidate = path.resolve(candidate);
	const resolvedTempRoot = path.resolve(os.tmpdir());
	const basename = path.basename(resolvedCandidate);
	return (
		path.dirname(resolvedCandidate) === resolvedTempRoot &&
		basename.startsWith(RUNTIME_ROOT_PREFIX) &&
		basename.length > RUNTIME_ROOT_PREFIX.length
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

function isolatedProviderEnv(
	env: NodeJS.ProcessEnv,
	runtimeRoot: string,
): NodeJS.ProcessEnv {
	const next: NodeJS.ProcessEnv = {
		HOME: path.join(runtimeRoot, "home"),
		TMPDIR: runtimeRoot,
		TEMP: runtimeRoot,
		TMP: runtimeRoot,
	};
	for (const key of [
		"PATH",
		"USER",
		"LOGNAME",
		"SHELL",
		"NODE_EXTRA_CA_CERTS",
		"SSL_CERT_FILE",
		"SSL_CERT_DIR",
	]) {
		const value = env[key];
		if (value) next[key] = value;
	}
	return next;
}

function redactDiagnostic(
	message: string,
	values: Array<string | undefined>,
): string {
	let redacted = message;
	for (const value of values) {
		if (!value) continue;
		redacted = redacted.split(value).join("[redacted]");
	}
	return redacted.slice(0, 500);
}

function normalizeTimeout(value: number | undefined): number {
	const timeoutMs = value ?? DEFAULT_CODEX_LIVE_TIMEOUT_MS;
	if (
		!Number.isInteger(timeoutMs) ||
		timeoutMs < MIN_TIMEOUT_MS ||
		timeoutMs > MAX_TIMEOUT_MS
	) {
		throw new CodexLiveVerificationError(
			"timeout_invalid",
			`Codex live timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds.`,
		);
	}
	return timeoutMs;
}

export async function verifyCodexLive(
	options: CodexLiveVerificationOptions,
	dependencies: CodexLiveVerificationDependencies = {},
): Promise<CodexLiveVerificationResult> {
	const env = options.env ?? process.env;
	if (env[CODEX_LIVE_OPT_IN_ENV] !== "1") {
		throw new CodexLiveVerificationError(
			"live_opt_in_required",
			`${CODEX_LIVE_OPT_IN_ENV}=1 is required before a billable Codex live turn can run.`,
		);
	}

	const model = options.model.trim();
	if (!model) {
		throw new CodexLiveVerificationError(
			"model_required",
			"A Codex model must be supplied with --model.",
		);
	}
	const apiKey = requiredCredential(env);
	if (!apiKey) {
		throw new CodexLiveVerificationError(
			"credentials_missing",
			"OPENAI_API_KEY or CODEX_API_KEY is required. The live verifier does not reuse the personal Codex auth cache.",
		);
	}
	const timeoutMs = normalizeTimeout(options.timeoutMs);
	let runtimeRoot: string;
	try {
		runtimeRoot = await (
			dependencies.createRuntimeRoot ??
			(() => fs.mkdtemp(path.join(os.tmpdir(), RUNTIME_ROOT_PREFIX)))
		)();
		if (!isOwnedRuntimeRoot(runtimeRoot)) {
			throw new Error("Unowned Codex runtime root.");
		}
	} catch {
		throw new CodexLiveVerificationError(
			"runtime_setup_failed",
			"Failed to create the isolated Codex runtime.",
		);
	}
	const codexHome = path.join(runtimeRoot, "codex-home");
	const home = path.join(runtimeRoot, "home");
	const now = dependencies.now ?? Date.now;
	const started = now();
	let outcome:
		| { ok: true; result: CodexLiveVerificationResult }
		| { ok: false; error: unknown };

	try {
		try {
			await Promise.all([
				fs.mkdir(codexHome, { recursive: true }),
				fs.mkdir(home, { recursive: true }),
			]);
		} catch {
			throw new CodexLiveVerificationError(
				"runtime_setup_failed",
				"Failed to prepare the isolated Codex runtime.",
			);
		}

		let response: LlmResponse;
		try {
			const providerFactory =
				dependencies.providerFactory ??
				((config: CodexSdkProviderConfig) => new CodexSdkProvider(config));
			const provider = providerFactory({
				model,
				apiKey,
				codexHome,
				timeoutMs,
				reasoningEffort: "low",
				tmpRoot: runtimeRoot,
				env: isolatedProviderEnv(env, runtimeRoot),
			});
			response = await provider.chatCompletion(
				[
					{
						role: "system",
						content:
							"Return only the JSON object requested by the user. Do not inspect files, run commands, or use external tools.",
					},
					{
						role: "user",
						content: `Return {"ok":true,"marker":"${CODEX_LIVE_MARKER}"}.`,
					},
				],
				{ outputSchema: codexLiveOutputSchema },
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new CodexLiveVerificationError(
				"provider_execution_failed",
				redactDiagnostic(message, [apiKey, runtimeRoot, codexHome, home]),
			);
		}

		try {
			CodexLiveOutputSchema.parse(JSON.parse(response.content));
		} catch {
			throw new CodexLiveVerificationError(
				"response_invalid",
				"Codex returned a response that did not satisfy the live contract schema.",
			);
		}

		outcome = {
			ok: true,
			result: {
				ok: true,
				status: "passed",
				model,
				runtimeMode: "bun-direct",
				durationMs: Math.max(0, now() - started),
				threadId: response.id,
				usage: response.usage ?? null,
				outputValidated: true,
			},
		};
	} catch (error) {
		outcome = { ok: false, error };
	}

	try {
		await (
			dependencies.removeRuntimeRoot ??
			((root) =>
				fs.rm(root, {
					recursive: true,
					force: true,
				}))
		)(runtimeRoot);
		if (!(await pathWasRemoved(runtimeRoot))) {
			throw new Error("Codex runtime root still exists.");
		}
	} catch {
		throw new CodexLiveVerificationError(
			"cleanup_failed",
			"Failed to remove the isolated Codex runtime.",
		);
	}

	if (!outcome.ok) throw outcome.error;
	return outcome.result;
}

function requiredFlagValue(
	argv: string[],
	index: number,
	flag: "--model" | "--timeout-ms",
): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("-")) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

export function parseCodexLiveArgs(argv: string[]): CodexLiveCliArgs {
	let model = "";
	let timeoutMs = DEFAULT_CODEX_LIVE_TIMEOUT_MS;
	let help = false;
	let modelSeen = false;
	let timeoutSeen = false;
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--help" || token === "-h") {
			help = true;
			continue;
		}
		if (token === "--model") {
			if (modelSeen) throw new Error("--model may only be specified once.");
			modelSeen = true;
			model = requiredFlagValue(argv, index, token);
			index += 1;
			continue;
		}
		if (token === "--timeout-ms") {
			if (timeoutSeen) {
				throw new Error("--timeout-ms may only be specified once.");
			}
			timeoutSeen = true;
			const raw = requiredFlagValue(argv, index, token);
			if (!/^\d+$/.test(raw)) {
				throw new Error("--timeout-ms requires a decimal integer.");
			}
			timeoutMs = Number(raw);
			index += 1;
			continue;
		}
		throw new Error("Unknown argument.");
	}
	return { help, model, timeoutMs };
}

function usage(): string {
	return [
		"Usage:",
		`  ${CODEX_LIVE_OPT_IN_ENV}=1 bun run verify:codex-live -- --model <model> [--timeout-ms <milliseconds>]`,
		"",
		"Requires OPENAI_API_KEY or CODEX_API_KEY. This command runs one billable Codex turn.",
	].join("\n");
}

async function main(): Promise<void> {
	try {
		const args = parseCodexLiveArgs(process.argv.slice(2));
		if (args.help) {
			console.log(usage());
			return;
		}
		console.log(
			JSON.stringify(
				await verifyCodexLive({
					model: args.model,
					timeoutMs: args.timeoutMs,
				}),
			),
		);
	} catch (error) {
		const failure =
			error instanceof CodexLiveVerificationError
				? {
						ok: false,
						status: "failed",
						code: error.code,
						message: error.message,
					}
				: {
						ok: false,
						status: "failed",
						code: "invalid_arguments",
						message: error instanceof Error ? error.message : String(error),
					};
		console.error(JSON.stringify(failure));
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	await main();
}
