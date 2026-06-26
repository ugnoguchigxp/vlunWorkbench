import type { AppEnv } from "../app/env";
import type { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import {
	LLM_TASK_POLICIES,
	type LlmModelTarget,
	type LlmProviderEndpointSettings,
	type LlmTask,
} from "../modules/llm-settings/llm-settings.schema";
import {
	createLlmProviderForEndpoint,
	LlmProviderFactoryError,
} from "./llmProviderFactory";
import type { LlmRouteFailureKind, LlmRouteResolution } from "./llmTaskTypes";

export type LlmRouteOverride = Partial<LlmModelTarget>;

function hasOverride(override: LlmRouteOverride): boolean {
	return (
		override.providerEndpointId !== undefined ||
		override.model !== undefined ||
		override.thinkingDepth !== undefined
	);
}

function mergeTarget(
	target: LlmModelTarget | null | undefined,
	override: LlmRouteOverride,
): LlmModelTarget | null {
	const providerEndpointId =
		override.providerEndpointId ?? target?.providerEndpointId;
	const model = override.model ?? target?.model;
	if (!providerEndpointId || !model) return null;
	const thinkingDepth = override.thinkingDepth ?? target?.thinkingDepth;
	return {
		providerEndpointId,
		model,
		...(thinkingDepth !== undefined ? { thinkingDepth } : {}),
	};
}

export class LlmRouter {
	constructor(
		private readonly repository: LlmSettingsRepository,
		private readonly env?: AppEnv,
	) {}

	async resolve(
		task: LlmTask,
		override: LlmRouteOverride = {},
	): Promise<LlmRouteResolution> {
		const settings = await this.repository.getSettings({
			maskSecrets: false,
			seedFromEnv: true,
		});

		const endpoints = new Map(
			settings.providerEndpoints.map((endpoint) => [endpoint.id, endpoint]),
		);
		const route = settings.taskRoutes.find(
			(candidate) => candidate.task === task,
		);
		const overrideProvided = hasOverride(override);
		const overrideTarget = mergeTarget(route?.primaryTarget, override);
		if (!route && !overrideTarget) {
			return {
				ok: false,
				task,
				failureKind: "llm_route_missing",
				message: `No LLM task route is configured for task ${task}.`,
			};
		}
		if (!overrideTarget && !route?.primaryTarget) {
			return {
				ok: false,
				task,
				failureKind: "llm_route_target_missing",
				message: `LLM task route ${task} does not have a primary target.`,
			};
		}

		const primaryTarget = overrideTarget ?? route?.primaryTarget;
		const routeTargets = primaryTarget
			? [
					primaryTarget,
					...(!overrideProvided && route?.policy.fallbackMode === "explicit"
						? route.fallbackTargets
						: []),
				]
			: [];
		const targets = routeTargets;
		let lastFailure: LlmRouteResolution | null = null;

		for (const target of targets) {
			const endpoint = endpoints.get(target.providerEndpointId);
			const validationFailure = this.validateTarget(
				task,
				target,
				endpoint,
				route?.policy.allowCodex,
			);
			if (validationFailure) {
				lastFailure = {
					ok: false,
					task,
					failureKind: validationFailure.failureKind,
					message: validationFailure.message,
				};
				continue;
			}
			if (!endpoint) {
				lastFailure = {
					ok: false,
					task,
					failureKind: "llm_provider_missing",
					message: `LLM provider endpoint ${target.providerEndpointId} is missing.`,
				};
				continue;
			}
			try {
				const provider = createLlmProviderForEndpoint({
					endpoint,
					model: target.model,
					env: this.env,
				});
				return {
					ok: true,
					task,
					target,
					provider,
					providerName: `${endpoint.kind}:${endpoint.id}`,
					model: target.model,
				};
			} catch (error) {
				lastFailure = {
					ok: false,
					task,
					failureKind:
						error instanceof LlmProviderFactoryError
							? error.failureKind
							: "llm_provider_adapter_unavailable",
					message: error instanceof Error ? error.message : String(error),
				};
			}
		}

		return (
			lastFailure ?? {
				ok: false,
				task,
				failureKind: "llm_route_target_missing",
				message: `LLM task route ${task} did not include a usable target.`,
			}
		);
	}

	private validateTarget(
		task: LlmTask,
		target: LlmModelTarget,
		endpoint?: LlmProviderEndpointSettings,
		allowCodexOverride?: boolean,
	): { failureKind: LlmRouteFailureKind; message: string } | null {
		if (!endpoint) {
			return {
				failureKind: "llm_provider_missing",
				message: `LLM provider endpoint ${target.providerEndpointId} is missing.`,
			};
		}
		if (!endpoint.enabled) {
			return {
				failureKind: "llm_provider_disabled",
				message: `LLM provider endpoint ${endpoint.id} is disabled.`,
			};
		}
		const policy = LLM_TASK_POLICIES[task];
		const allowCodex = allowCodexOverride ?? policy.defaultAllowCodex;
		if (endpoint.kind === "codex" && !allowCodex) {
			return {
				failureKind: "llm_provider_kind_not_allowed",
				message: `Provider kind codex is not allowed for task ${task}.`,
			};
		}
		if (!policy.allowProviderKinds.includes(endpoint.kind)) {
			return {
				failureKind: "llm_provider_kind_not_allowed",
				message: `Provider kind ${endpoint.kind} is not allowed for task ${task}.`,
			};
		}
		if (!endpoint.models.includes(target.model)) {
			return {
				failureKind: "llm_model_not_configured",
				message: `Model ${target.model} is not configured on endpoint ${endpoint.id}.`,
			};
		}
		return null;
	}
}
