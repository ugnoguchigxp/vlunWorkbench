import type {
	LlmModelTarget,
	LlmTask,
} from "../modules/llm-settings/llm-settings.schema";
import type { LlmProvider } from "./types";

export type { LlmModelTarget, LlmTask };

export type LlmRouteFailureKind =
	| "llm_route_missing"
	| "llm_route_target_missing"
	| "llm_provider_missing"
	| "llm_provider_disabled"
	| "llm_provider_kind_not_allowed"
	| "llm_model_not_configured"
	| "llm_provider_adapter_unavailable"
	| "llm_provider_credentials_missing"
	| "llm_provider_execution_failed"
	| "llm_structured_output_validation_failed";

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
			failureKind: LlmRouteFailureKind;
			message: string;
	  };
