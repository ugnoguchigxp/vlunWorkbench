import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, readAppEnv } from "../app/env";
import { RuntimeSettingsUpdateSchema } from "../config/runtime-settings";
import { requireAdmin } from "../middleware/auth";
import { getAuthContextUser } from "../modules/auth/context";
import { readCodexStatus } from "../modules/llm-settings/codex-status";
import type { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { LlmSettingsDocumentSchema } from "../modules/llm-settings/llm-settings.schema";
import { checkLlmProviderHealth } from "../modules/llm-settings/provider-health";
import {
	autoConfigureLocalRuntimeIsolation,
	mergeAutoConfiguredRuntimeIsolationSettings,
	pruneStaleLocalRuntimeImages,
	RuntimeIsolationAutoConfigError,
} from "../modules/runtime-isolation/runtime-isolation-auto-config";
import type {
	RuntimeSettingsUpdateOptions,
	SettingsRepository,
} from "../modules/settings/settings.repository";
import { resolveProviderCredential } from "../providers/provider-credential-resolver";

const UpdateSystemContextSchema = z.object({
	systemContext: z.string().max(16_000),
});

type SettingsRouteDeps = {
	settingsRepository: SettingsRepository;
	llmSettingsRepository?: LlmSettingsRepository;
	runtimeEnv?: AppEnv;
	onRuntimeSettingsUpdated?: (env: AppEnv) => void | Promise<void>;
	autoConfigureRuntimeIsolation?: typeof autoConfigureLocalRuntimeIsolation;
	pruneRuntimeIsolationImages?: typeof pruneStaleLocalRuntimeImages;
};

export function createSettingsRoute(deps: SettingsRouteDeps) {
	if (!deps?.settingsRepository) {
		throw new Error("settingsRepository is not configured");
	}
	const repo = deps.settingsRepository;
	const llmRepo = deps.llmSettingsRepository;
	const autoConfigureRuntimeIsolation =
		deps.autoConfigureRuntimeIsolation ?? autoConfigureLocalRuntimeIsolation;
	const pruneRuntimeIsolationImages =
		deps.pruneRuntimeIsolationImages ?? pruneStaleLocalRuntimeImages;
	const updateRuntimeSettings = async (
		input: unknown,
		options?: RuntimeSettingsUpdateOptions,
	) => {
		const env = deps.runtimeEnv ?? readAppEnv();
		const updated = await repo.updateRuntimeSettings(input, env, options);
		if (deps.runtimeEnv) {
			Object.assign(deps.runtimeEnv, await repo.resolveAppEnv(env));
			await deps.onRuntimeSettingsUpdated?.(deps.runtimeEnv);
		}
		return updated;
	};

	return new Hono()
		.use("/runtime", requireAdmin())
		.use("/runtime/*", requireAdmin())
		.use("/llm", requireAdmin())
		.use("/llm/*", requireAdmin())
		.get("/system-context", async (c) => {
			const authUser = getAuthContextUser(c);
			const record = await repo.getSystemContextForUser(authUser.userId);
			return c.json({
				systemContext: record.systemContext,
				updatedAt: record.updatedAt.toISOString(),
			});
		})
		.put(
			"/system-context",
			zValidator("json", UpdateSystemContextSchema),
			async (c) => {
				const authUser = getAuthContextUser(c);
				const body = c.req.valid("json");
				const record = await repo.updateSystemContext(
					body.systemContext,
					authUser.userId,
				);
				return c.json({
					systemContext: record.systemContext,
					updatedAt: record.updatedAt.toISOString(),
				});
			},
		)
		.get("/runtime", async (c) => {
			const env = deps.runtimeEnv ?? readAppEnv();
			return c.json(await repo.getRuntimeSettings(env));
		})
		.put(
			"/runtime",
			zValidator("json", RuntimeSettingsUpdateSchema),
			async (c) => c.json(await updateRuntimeSettings(c.req.valid("json"))),
		)
		.post(
			"/runtime/dast-auth-key/generate",
			zValidator("json", RuntimeSettingsUpdateSchema),
			async (c) =>
				c.json(
					await updateRuntimeSettings({
						...c.req.valid("json"),
						dastAuthEncryptionKey: randomBytes(32).toString("base64"),
					}),
				),
		)
		.post("/runtime/isolation/auto-configure", async (c) => {
			try {
				const runtimeIsolation = await autoConfigureRuntimeIsolation();
				const env = deps.runtimeEnv ?? readAppEnv();
				const current = await repo.getRuntimeSettings(env);
				const mergedRuntimeIsolation =
					mergeAutoConfiguredRuntimeIsolationSettings(
						current.runtimeIsolation,
						runtimeIsolation,
					);
				const {
					updatedAt: _updatedAt,
					dastAuthEncryptionKeyConfigured: _keyConfigured,
					dastAuthEncryptionKeySource: _keySource,
					runtimeIsolationConfigured: _runtimeConfigured,
					runtimeIsolationMissingFields: _runtimeMissingFields,
					...input
				} = current;
				const updated = await updateRuntimeSettings(
					{
						...input,
						runtimeIsolation: mergedRuntimeIsolation,
					},
					{ trustRuntimeIsolationQualification: true },
				);
				if (!(await pruneRuntimeIsolationImages())) {
					console.warn(
						"Stale local runtime Docker images could not be pruned.",
					);
				}
				return c.json(updated);
			} catch (error) {
				if (error instanceof RuntimeIsolationAutoConfigError) {
					return c.json(
						{ message: error.message, code: error.code },
						error.status,
					);
				}
				throw error;
			}
		})
		.get("/llm", async (c) => {
			if (!llmRepo) {
				return c.json({
					providerEndpoints: [],
					taskRoutes: [],
					updatedAt: null,
				});
			}
			return c.json(await llmRepo.getSettings({ maskSecrets: true }));
		})
		.put("/llm", zValidator("json", LlmSettingsDocumentSchema), async (c) => {
			if (!llmRepo) {
				return c.json(
					{ ok: false, message: "LLM settings are not configured." },
					500,
				);
			}
			try {
				return c.json(await llmRepo.updateSettings(c.req.valid("json")));
			} catch (error) {
				return c.json(
					{
						ok: false,
						message: error instanceof Error ? error.message : String(error),
					},
					400,
				);
			}
		})
		.get("/llm/codex/status", async (c) => {
			const settings = await llmRepo?.getSettings({ maskSecrets: false });
			const codexEndpoint = settings?.providerEndpoints.find(
				(endpoint) => endpoint.kind === "codex",
			);
			const codexModels =
				settings?.providerEndpoints
					.filter((endpoint) => endpoint.kind === "codex")
					.flatMap((endpoint) => endpoint.models) ?? [];
			return c.json(
				await readCodexStatus({
					settingsModels: codexModels,
					codexApiKey: codexEndpoint?.apiKey,
				}),
			);
		})
		.post("/llm/provider-endpoints/:id/health", async (c) => {
			if (!llmRepo) {
				return c.json(
					{ ok: false, message: "LLM settings are not configured." },
					500,
				);
			}
			const endpoint = await llmRepo.findEndpointById(c.req.param("id"), {
				maskSecrets: false,
			});
			if (!endpoint) {
				return c.json(
					{ ok: false, message: "Provider endpoint not found." },
					404,
				);
			}
			const env = readAppEnv();
			const apiKey = resolveProviderCredential(endpoint, env).apiKey;
			const urlPolicyKind =
				endpoint.kind === "azure" ||
				endpoint.kind === "openai" ||
				endpoint.kind === "openai-compatible" ||
				endpoint.kind === "local"
					? endpoint.kind
					: null;
			const allowedHosts = [...(env.llmProviderAllowedHosts ?? [])];
			if (endpoint.kind === "azure" && env.azureOpenAiEndpoint) {
				allowedHosts.push(new URL(env.azureOpenAiEndpoint).hostname);
			}
			const result = await checkLlmProviderHealth(endpoint, {
				apiKey,
				outboundPolicy: urlPolicyKind
					? {
							kind: urlPolicyKind,
							nodeEnv: env.nodeEnv,
							allowedHosts,
						}
					: undefined,
			});
			await llmRepo.recordHealthCheck(endpoint.id, result);
			return c.json(result);
		});
}
