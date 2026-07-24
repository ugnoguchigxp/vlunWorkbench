import type { PromptInvocation } from "s11tnext";

export type PromptMessageManifest = PromptInvocation["manifest"];

/** @deprecated Use PromptMessageManifest. */
export type SystemContextManifest = PromptMessageManifest;

export type PromptMessageAudit = {
	promptMessages: readonly PromptMessageManifest[];
	promptSequenceHash: string;
};
