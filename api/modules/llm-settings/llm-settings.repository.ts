import { eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../../app/env";
import type { AppDatabase } from "../../db";
import {
	llmProviderEndpoints,
	llmProviderHealthChecks,
	llmTaskRoutes,
} from "../../db/schema";
import { readCodexStatus } from "./codex-status";
import {
	type LlmModelTarget,
	type LlmProviderEndpointSettings,
	type LlmSettingsDocument,
	LlmSettingsDocumentSchema,
	type LlmSettingsResponse,
	type LlmTask,
	type LlmTaskRouteSettings,
	validateLlmRouteTargets,
} from "./llm-settings.schema";
import type { LlmProviderHealthResult } from "./provider-health";
import { isMaskedSecret, maskSecret } from "./secret-mask";

type GetSettingsOptions = {
	maskSecrets?: boolean;
	seedFromEnv?: boolean;
};

function endpointRowToSettings(
	row: typeof llmProviderEndpoints.$inferSelect,
): LlmProviderEndpointSettings {
	return {
		id: row.id,
		name: row.name,
		kind: row.kind as LlmProviderEndpointSettings["kind"],
		enabled: row.enabled,
		apiKey: row.apiKey ?? "",
		baseUrl: row.baseUrl ?? "",
		endpoint: row.endpoint ?? "",
		apiVersion: row.apiVersion ?? "",
		region: row.region ?? "",
		models: row.models,
		modelDisplayNames: row.modelDisplayNames,
		defaultModelCapability: row.defaultModelCapability ?? undefined,
		modelCapabilities: row.modelCapabilities,
	};
}

function routeRowToSettings(
	row: typeof llmTaskRoutes.$inferSelect,
): LlmTaskRouteSettings {
	const primaryTarget =
		row.primaryProviderEndpointId && row.primaryModel
			? {
					providerEndpointId: row.primaryProviderEndpointId,
					model: row.primaryModel,
					thinkingDepth: (row.primaryThinkingDepth ?? undefined) as
						| LlmModelTarget["thinkingDepth"]
						| undefined,
				}
			: null;

	return {
		task: row.task as LlmTask,
		primaryTarget,
		fallbackTargets: row.fallbackTargets.map((target) => ({
			...target,
			thinkingDepth: (target.thinkingDepth ?? undefined) as
				| LlmModelTarget["thinkingDepth"]
				| undefined,
		})),
		policy: row.policy as LlmTaskRouteSettings["policy"],
	};
}

function latestUpdatedAt(
	endpoints: Array<typeof llmProviderEndpoints.$inferSelect>,
	routes: Array<typeof llmTaskRoutes.$inferSelect>,
): Date | null {
	const dates = [...endpoints, ...routes]
		.map((row) => row.updatedAt)
		.filter((date): date is Date => date instanceof Date);
	if (dates.length === 0) return null;
	return new Date(Math.max(...dates.map((date) => date.getTime())));
}

export class LlmSettingsRepository {
	constructor(
		private readonly db: AppDatabase,
		private readonly env?: AppEnv,
	) {}

	private async buildDefaultCodexEndpoint(): Promise<LlmProviderEndpointSettings> {
		const status = await readCodexStatus();
		return {
			id: "codex-default",
			name: "Codex SDK",
			kind: "codex",
			enabled: status.authenticated,
			apiKey: "",
			baseUrl: "",
			endpoint: "",
			apiVersion: "",
			region: "",
			models: status.detectedModels,
			modelDisplayNames: {},
			modelCapabilities: {},
		};
	}

	private async buildEnvSeed(): Promise<LlmSettingsDocument> {
		const providerEndpoints: LlmProviderEndpointSettings[] = [];

		if (this.env?.azureOpenAiEndpoint && this.env.azureOpenAiApiKey) {
			providerEndpoints.push({
				id: "azure-env-default",
				name: "Azure OpenAI (environment)",
				kind: "azure",
				enabled: true,
				apiKey: "",
				baseUrl: "",
				endpoint: this.env.azureOpenAiEndpoint,
				apiVersion: this.env.azureOpenAiApiVersion,
				region: "",
				models: [this.env.azureOpenAiDeployment],
				modelDisplayNames: {},
				modelCapabilities: {},
			});
		}

		if (
			this.env?.openAiCredentialSource === "openai" &&
			this.env.openAiApiKey
		) {
			providerEndpoints.push({
				id: "openai-env-default",
				name: "OpenAI (environment)",
				kind: "openai",
				enabled: true,
				apiKey: "",
				baseUrl: this.env.openAiBaseUrl ?? "https://api.openai.com/v1",
				endpoint: "",
				apiVersion: "",
				region: "",
				models: [this.env.openAiAgenticSearchModel],
				modelDisplayNames: {},
				modelCapabilities: {},
			});
		}

		providerEndpoints.push({
			id: "local-template",
			name: "Local LLM",
			kind: "local",
			enabled: false,
			apiKey: "",
			baseUrl: "http://127.0.0.1:11434/v1",
			endpoint: "",
			apiVersion: "",
			region: "",
			models: ["qwen3-coder"],
			modelDisplayNames: {},
			modelCapabilities: {},
		});

		providerEndpoints.push(await this.buildDefaultCodexEndpoint());

		return { providerEndpoints, taskRoutes: [] };
	}

	private async ensureSeededFromEnv(): Promise<void> {
		const existing = await this.db.query.llmProviderEndpoints.findFirst();
		if (existing) return;
		const seed = await this.buildEnvSeed();
		await this.replaceSettings(seed);
	}

	async getSettings(
		options: GetSettingsOptions = {},
	): Promise<LlmSettingsResponse> {
		const shouldSeed = options.seedFromEnv ?? true;
		if (shouldSeed) {
			await this.ensureSeededFromEnv();
		}
		const endpoints = await this.db.query.llmProviderEndpoints.findMany();
		const routes = await this.db.query.llmTaskRoutes.findMany();
		const maskSecrets = options.maskSecrets ?? true;
		const providerEndpoints = endpoints.map(endpointRowToSettings);
		if (!providerEndpoints.some((endpoint) => endpoint.kind === "codex")) {
			providerEndpoints.push(await this.buildDefaultCodexEndpoint());
		}

		return {
			providerEndpoints: providerEndpoints.map((endpoint) => {
				return {
					...endpoint,
					apiKey: maskSecrets ? maskSecret(endpoint.apiKey) : endpoint.apiKey,
				};
			}),
			taskRoutes: routes.map(routeRowToSettings),
			updatedAt: latestUpdatedAt(endpoints, routes)?.toISOString() ?? null,
		};
	}

	private mergeMaskedSecrets(
		settings: LlmSettingsDocument,
		existingById: Map<string, LlmProviderEndpointSettings>,
	): LlmSettingsDocument {
		return {
			...settings,
			providerEndpoints: settings.providerEndpoints.map((endpoint) => {
				if (!isMaskedSecret(endpoint.apiKey)) return endpoint;
				const existing = existingById.get(endpoint.id);
				return {
					...endpoint,
					apiKey: existing?.apiKey ?? "",
				};
			}),
		};
	}

	private async replaceSettings(settings: LlmSettingsDocument): Promise<void> {
		validateLlmRouteTargets(settings);
		const now = new Date();
		await this.db.delete(llmTaskRoutes);
		await this.db.delete(llmProviderEndpoints);

		if (settings.providerEndpoints.length > 0) {
			await this.db.insert(llmProviderEndpoints).values(
				settings.providerEndpoints.map((endpoint) => ({
					id: endpoint.id,
					name: endpoint.name,
					kind: endpoint.kind,
					enabled: endpoint.enabled,
					apiKey: endpoint.apiKey || null,
					baseUrl: endpoint.baseUrl,
					endpoint: endpoint.endpoint,
					apiVersion: endpoint.apiVersion,
					region: endpoint.region,
					models: endpoint.models,
					modelDisplayNames: endpoint.modelDisplayNames,
					defaultModelCapability: endpoint.defaultModelCapability ?? null,
					modelCapabilities: endpoint.modelCapabilities,
					createdAt: now,
					updatedAt: now,
				})),
			);
		}

		if (settings.taskRoutes.length > 0) {
			await this.db.insert(llmTaskRoutes).values(
				settings.taskRoutes.map((route) => ({
					task: route.task,
					primaryProviderEndpointId:
						route.primaryTarget?.providerEndpointId ?? null,
					primaryModel: route.primaryTarget?.model ?? null,
					primaryThinkingDepth: route.primaryTarget?.thinkingDepth ?? null,
					fallbackTargets: route.fallbackTargets,
					policy: route.policy,
					createdAt: now,
					updatedAt: now,
				})),
			);
		}
	}

	async updateSettings(input: unknown): Promise<LlmSettingsResponse> {
		const parsed = LlmSettingsDocumentSchema.parse(input);
		const existing = await this.getSettings({
			maskSecrets: false,
			seedFromEnv: false,
		});
		const existingById = new Map(
			existing.providerEndpoints.map((endpoint) => [endpoint.id, endpoint]),
		);
		const merged = this.mergeMaskedSecrets(parsed, existingById);
		validateLlmRouteTargets(merged);
		await this.replaceSettings(merged);
		return this.getSettings({ maskSecrets: true, seedFromEnv: false });
	}

	async findEndpointById(
		id: string,
		options: { maskSecrets?: boolean } = {},
	): Promise<LlmProviderEndpointSettings | null> {
		await this.ensureSeededFromEnv();
		const row = await this.db.query.llmProviderEndpoints.findFirst({
			where: eq(llmProviderEndpoints.id, id),
		});
		if (!row) return null;
		const endpoint = endpointRowToSettings(row);
		return {
			...endpoint,
			apiKey:
				(options.maskSecrets ?? false)
					? maskSecret(endpoint.apiKey)
					: endpoint.apiKey,
		};
	}

	async listEndpointsByIds(
		ids: string[],
	): Promise<LlmProviderEndpointSettings[]> {
		if (ids.length === 0) return [];
		const rows = await this.db.query.llmProviderEndpoints.findMany({
			where: inArray(llmProviderEndpoints.id, ids),
		});
		return rows.map(endpointRowToSettings);
	}

	async recordHealthCheck(
		providerEndpointId: string,
		result: LlmProviderHealthResult,
	): Promise<void> {
		await this.db.insert(llmProviderHealthChecks).values({
			providerEndpointId,
			ok: result.ok,
			reachable: result.reachable,
			status: result.status,
			url: result.url,
			message: result.message,
			durationMs: result.durationMs,
			checkedAt: new Date(result.checkedAt),
		});
	}
}
