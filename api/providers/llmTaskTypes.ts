import type {
	LlmModelTarget,
	LlmTask,
} from "../modules/llm-settings/llm-settings.schema";
import type { LlmProvider } from "./types";

export type { LlmModelTarget, LlmTask };

export type LlmRouteResolution =
	| {
			ok: true;
			task: LlmTask;
			target: LlmModelTarget;
			provider: LlmProvider;
			providerName: string;
			model: string;
	  }
	| {
			ok: false;
			task: LlmTask;
			failureKind: "llm_provider_unconfigured";
			message: string;
	  };
