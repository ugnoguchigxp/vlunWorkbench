import { eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../../app/env";
import {
	type AppDatabase,
	runInProcessDbTransaction,
	writerClientForDatabase,
} from "../../db";
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
import { validateOutboundUrlSyntax } from "../../security/outbound-url-policy";
import { SecretCrypto } from "../../security/secret-crypto";

type GetSettingsOptions = {
	maskSecrets?: boolean;
	seedFromEnv?: boolean;
};

function endpointRowToSettings(
	row: typeof llmProviderEndpoints.$inferSelect,
	secretCrypto?: SecretCrypto,
	allowLegacyPlaintext = true,
): LlmProviderEndpointSettings {
	const encryptedValues = [
		row.apiKeyCiphertext,
		row.apiKeyNonce,
		row.apiKeyAuthTag,
		row.apiKeyKeyId,
	];
	const hasEncryptedSecret = encryptedValues.some(Boolean);
	if (hasEncryptedSecret && !encryptedValues.every(Boolean)) {
		throw new Error(`Stored LLM secret is incomplete for endpoint ${row.id}.`);
	}
	if (!hasEncryptedSecret && row.apiKey && !allowLegacyPlaintext) {
		throw new Error(
			`Legacy plaintext LLM secret requires explicit migration for endpoint ${row.id}.`,
		);
	}
	const encryptedSecret =
		row.apiKeyCiphertext &&
		row.apiKeyNonce &&
		row.apiKeyAuthTag &&
		row.apiKeyKeyId
			? {
					ciphertext: row.apiKeyCiphertext,
					nonce: row.apiKeyNonce,
					authTag: row.apiKeyAuthTag,
					keyId: row.apiKeyKeyId,
				}
			: undefined;
	const decryptedApiKey = hasEncryptedSecret
		? encryptedSecret &&
			secretCrypto?.decrypt(encryptedSecret, {
				endpointId: row.id,
				providerKind: row.kind,
			})
		: (row.apiKey ?? "");
	if (hasEncryptedSecret && decryptedApiKey === undefined) {
		throw new Error(
			`LLM_SETTINGS_ENCRYPTION_KEY is required for endpoint ${row.id}.`,
		);
	}
	const apiKey = decryptedApiKey ?? "";
	return {
		id: row.id,
		name: row.name,
		kind: row.kind as LlmProviderEndpointSettings["kind"],
		enabled: row.enabled,
		apiKey,
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
	private readonly secretCrypto?: SecretCrypto;

	constructor(
		private readonly db: AppDatabase,
		private readonly env?: AppEnv,
	) {
		this.secretCrypto = env?.llmSettingsEncryptionKey
			? new SecretCrypto(
					env.llmSettingsEncryptionKey,
					env.llmSettingsPreviousEncryptionKeys ?? [],
				)
			: undefined;
	}

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

	async getSettings(
		options: GetSettingsOptions = {},
	): Promise<LlmSettingsResponse> {
		const endpoints = await this.db.query.llmProviderEndpoints.findMany();
		const routes = await this.db.query.llmTaskRoutes.findMany();
		const maskSecrets = options.maskSecrets ?? true;
		const envSeed = endpoints.length === 0 ? await this.buildEnvSeed() : null;
		const providerEndpoints = envSeed
			? envSeed.providerEndpoints
			: endpoints.map((endpoint) =>
					endpointRowToSettings(
						endpoint,
						this.secretCrypto,
						this.env?.nodeEnv !== "production",
					),
				);
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
			taskRoutes:
				routes.length > 0
					? routes.map(routeRowToSettings)
					: (envSeed?.taskRoutes ?? []),
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
		const endpointValues = settings.providerEndpoints.map((endpoint) => {
			if (endpoint.apiKey && !this.secretCrypto) {
				throw new Error(
					"LLM_SETTINGS_ENCRYPTION_KEY is required before storing provider credentials.",
				);
			}
			const encrypted = endpoint.apiKey
				? this.secretCrypto?.encrypt(endpoint.apiKey, {
						endpointId: endpoint.id,
						providerKind: endpoint.kind,
					})
				: undefined;
			return {
				id: endpoint.id,
				name: endpoint.name,
				kind: endpoint.kind,
				enabled: endpoint.enabled,
				apiKey: null,
				apiKeyCiphertext: encrypted?.ciphertext ?? null,
				apiKeyNonce: encrypted?.nonce ?? null,
				apiKeyAuthTag: encrypted?.authTag ?? null,
				apiKeyKeyId: encrypted?.keyId ?? null,
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
			};
		});
		const routeValues = settings.taskRoutes.map((route) => ({
			task: route.task,
			primaryProviderEndpointId:
				route.primaryTarget?.providerEndpointId ?? null,
			primaryModel: route.primaryTarget?.model ?? null,
			primaryThinkingDepth: route.primaryTarget?.thinkingDepth ?? null,
			fallbackTargets: route.fallbackTargets,
			policy: route.policy,
			createdAt: now,
			updatedAt: now,
		}));
		const writer = writerClientForDatabase(this.db);
		if (writer) {
			const queries: Array<{
				toSQL(): { sql: string; params: unknown[] };
			}> = [
				this.db.delete(llmTaskRoutes),
				this.db.delete(llmProviderEndpoints),
			];
			if (endpointValues.length > 0) {
				queries.push(
					this.db.insert(llmProviderEndpoints).values(endpointValues),
				);
			}
			if (routeValues.length > 0) {
				queries.push(this.db.insert(llmTaskRoutes).values(routeValues));
			}
			await writer.atomicDrizzleBatch(queries);
			return;
		}
		runInProcessDbTransaction(this.db, (tx) => {
			tx.delete(llmTaskRoutes).run();
			tx.delete(llmProviderEndpoints).run();
			if (endpointValues.length > 0) {
				tx.insert(llmProviderEndpoints).values(endpointValues).run();
			}
			if (routeValues.length > 0) {
				tx.insert(llmTaskRoutes).values(routeValues).run();
			}
		});
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
		if (this.env) {
			for (const endpoint of merged.providerEndpoints) {
				const kind =
					endpoint.kind === "azure" ||
					endpoint.kind === "openai" ||
					endpoint.kind === "openai-compatible" ||
					endpoint.kind === "local"
						? endpoint.kind
						: null;
				if (!kind) continue;
				const rawUrl = kind === "azure" ? endpoint.endpoint : endpoint.baseUrl;
				if (!rawUrl) continue;
				const allowedHosts = [...(this.env.llmProviderAllowedHosts ?? [])];
				if (kind === "azure" && this.env.azureOpenAiEndpoint) {
					allowedHosts.push(new URL(this.env.azureOpenAiEndpoint).hostname);
				}
				validateOutboundUrlSyntax(rawUrl, {
					kind,
					nodeEnv: this.env.nodeEnv,
					allowedHosts,
				});
			}
		}
		validateLlmRouteTargets(merged);
		await this.replaceSettings(merged);
		return this.getSettings({ maskSecrets: true, seedFromEnv: false });
	}

	async findEndpointById(
		id: string,
		options: { maskSecrets?: boolean } = {},
	): Promise<LlmProviderEndpointSettings | null> {
		const row = await this.db.query.llmProviderEndpoints.findFirst({
			where: eq(llmProviderEndpoints.id, id),
		});
		const endpoint = row
			? endpointRowToSettings(
					row,
					this.secretCrypto,
					this.env?.nodeEnv !== "production",
				)
			: ((await this.buildEnvSeed()).providerEndpoints.find(
					(candidate) => candidate.id === id,
				) ?? null);
		if (!endpoint) return null;
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
		return rows.map((row) =>
			endpointRowToSettings(
				row,
				this.secretCrypto,
				this.env?.nodeEnv !== "production",
			),
		);
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
