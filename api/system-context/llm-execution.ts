import { createHash } from "node:crypto";
import {
	type PromptInvocation,
	type SystemContextInvocation,
	verifyPromptMessageHash,
	verifyRenderedHash,
} from "s11tnext";
import type {
	LlmCompletionOptions,
	LlmProvider,
	LlmResponse,
} from "../providers/types";

export const MAX_RENDERED_PROMPT_MESSAGE_CHARS = 64_000;

/** @deprecated Use MAX_RENDERED_PROMPT_MESSAGE_CHARS. */
export const MAX_RENDERED_SYSTEM_CONTEXT_CHARS =
	MAX_RENDERED_PROMPT_MESSAGE_CHARS;

export type ApplicationChatMessage = {
	role: "user" | "assistant";
	content: string;
};

export type ExecutedLlmCompletion = {
	response: LlmResponse;
	systemContextManifest: SystemContextInvocation["manifest"];
	promptMessageManifests: readonly PromptInvocation["manifest"][];
	promptSequenceHash: string;
};

export type ExecutedPromptCompletion = {
	response: LlmResponse;
	promptMessageManifests: readonly PromptInvocation["manifest"][];
	promptSequenceHash: string;
};

export function assertPromptInvocation(invocation: PromptInvocation): void {
	const text = invocation.content.text;
	if (invocation.role !== invocation.manifest.messageRole) {
		throw new Error(`Prompt message role mismatch: ${invocation.manifest.key}`);
	}
	if (!verifyRenderedHash(text, invocation.manifest.renderedHash)) {
		throw new Error(
			`Prompt message rendered hash mismatch: ${invocation.manifest.key}`,
		);
	}
	if (
		!verifyPromptMessageHash(
			{ role: invocation.role, text },
			invocation.manifest.messageHash,
		)
	) {
		throw new Error(`Prompt message hash mismatch: ${invocation.manifest.key}`);
	}
	if (text.length > MAX_RENDERED_PROMPT_MESSAGE_CHARS) {
		throw new Error(
			`Prompt message exceeds ${MAX_RENDERED_PROMPT_MESSAGE_CHARS} characters: ${invocation.manifest.key}`,
		);
	}
}

/** @deprecated Use assertPromptInvocation. */
export const assertSystemContextInvocation = assertPromptInvocation;

export function hashPromptSequence(
	invocations: readonly PromptInvocation[],
): string {
	const entries = invocations.map((invocation) => ({
		role: invocation.role,
		messageHash: invocation.manifest.messageHash,
	}));
	const digest = createHash("sha256")
		.update(`s11tnext.prompt-sequence\0${JSON.stringify(entries)}`)
		.digest("hex");
	return `sha256:${digest}`;
}

export async function executePromptCompletion(params: {
	provider: LlmProvider;
	promptMessages: readonly PromptInvocation[];
	messages?: readonly ApplicationChatMessage[];
	options?: LlmCompletionOptions;
}): Promise<ExecutedPromptCompletion> {
	if (params.promptMessages.length === 0) {
		throw new Error("At least one authored prompt message is required.");
	}
	for (const invocation of params.promptMessages) {
		assertPromptInvocation(invocation);
	}
	for (const message of params.messages ?? []) {
		if (message.role !== "user" && message.role !== "assistant") {
			throw new Error("Application messages must not use the system role.");
		}
	}

	const response = await params.provider.chatCompletion(
		[
			...params.promptMessages.map((invocation) => ({
				role: invocation.role,
				content: invocation.content.text,
			})),
			...(params.messages ?? []),
		],
		params.options,
	);
	return {
		response,
		promptMessageManifests: params.promptMessages.map(
			(invocation) => invocation.manifest,
		),
		promptSequenceHash: hashPromptSequence(params.promptMessages),
	};
}

export async function executeLlmCompletion(params: {
	provider: LlmProvider;
	systemContext: SystemContextInvocation;
	messages: readonly ApplicationChatMessage[];
	options?: LlmCompletionOptions;
}): Promise<ExecutedLlmCompletion> {
	const execution = await executePromptCompletion({
		provider: params.provider,
		promptMessages: [params.systemContext],
		messages: params.messages,
		options: params.options,
	});
	return {
		response: execution.response,
		systemContextManifest: params.systemContext.manifest,
		promptMessageManifests: execution.promptMessageManifests,
		promptSequenceHash: execution.promptSequenceHash,
	};
}
