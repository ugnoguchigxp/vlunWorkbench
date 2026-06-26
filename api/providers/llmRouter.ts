import type { AppEnv } from "../app/env";
import type { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import {
	LLM_TASK_POLICIES,
	type LlmModelTarget,
	type LlmProviderEndpointSettings,
	type LlmTask,
	validateLlmRouteTargets,
} from "../modules/llm-settings/llm-settings.schema";
import { createLlmProviderForEndpoint } from "./llmProviderFactory";
import type { LlmRouteResolution } from "./llmTaskTypes";

export type LlmRouteOverride = Partial<LlmModelTarget>;

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

		try {
			validateLlmRouteTargets(settings);
		} catch (error) {
			return {
				ok: false,
				task,
				failureKind: "llm_provider_unconfigured",
				message: error instanceof Error ? error.message : String(error),
			};
		}

		const endpoints = new Map(
			settings.providerEndpoints.map((endpoint) => [endpoint.id, endpoint]),
		);
		const route = settings.taskRoutes.find(
			(candidate) => candidate.task === task,
		);
		const routeTargets = [
			...(route?.primaryTarget ? [route.primaryTarget] : []),
			...(route?.fallbackTargets ?? []),
		];
		const targets =
			override.providerEndpointId || override.model
				? [
						{
							providerEndpointId:
								override.providerEndpointId ??
								routeTargets[0]?.providerEndpointId ??
								"",
							model: override.model ?? routeTargets[0]?.model ?? "",
							thinkingDepth:
								override.thinkingDepth ?? routeTargets[0]?.thinkingDepth,
						},
					]
				: routeTargets;

		for (const target of targets) {
			const endpoint = endpoints.get(target.providerEndpointId);
			const validationMessage = this.validateTarget(
				task,
				target,
				endpoint,
				route?.policy.allowCodex,
			);
			if (validationMessage) continue;
			if (!endpoint) continue;
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
			} catch {}
		}

		return {
			ok: false,
			task,
			failureKind: "llm_provider_unconfigured",
			message: `No configured LLM provider route is available for task ${task}.`,
		};
	}

	private validateTarget(
		task: LlmTask,
		target: LlmModelTarget,
		endpoint?: LlmProviderEndpointSettings,
		_allowCodexOverride?: boolean,
	): string | null {
		if (!endpoint) return `Missing endpoint ${target.providerEndpointId}.`;
		if (!endpoint.enabled) return `Endpoint ${endpoint.id} is disabled.`;
		const policy = LLM_TASK_POLICIES[task];
		if (!policy.allowProviderKinds.includes(endpoint.kind)) {
			return `Provider kind ${endpoint.kind} is not allowed for ${task}.`;
		}
		if (!endpoint.models.includes(target.model)) {
			return `Model ${target.model} is not configured on ${endpoint.id}.`;
		}
		return null;
	}
}
