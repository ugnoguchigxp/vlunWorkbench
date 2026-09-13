import { logEvent } from "../app/logger";
import type { LlmProvider } from "./types";

/** Decorates the existing object so streaming and provider-specific methods survive. */
export function observeProvider<T extends LlmProvider>(provider: T): T {
	const complete = provider.chatCompletion.bind(provider);
	provider.chatCompletion = async (...args) => {
		const started = performance.now();
		try {
			return await complete(...args);
		} catch (error) {
			logEvent({
				level: "error",
				event: "llm.call.failed",
				errorCode: "provider_execution_failed",
				durationMs: performance.now() - started,
			});
			throw error;
		}
	};
	return provider;
}
