import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { readAppEnv } from "../app/env";
import { getAuthContextUser } from "../modules/auth/context";
import { readCodexStatus } from "../modules/llm-settings/codex-status";
import type { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { checkLlmProviderHealth } from "../modules/llm-settings/provider-health";
import type { SettingsRepository } from "../modules/settings/settings.repository";

const UpdateSystemContextSchema = z.object({
	systemContext: z.string(),
});

type SettingsRouteDeps = {
	settingsRepository: SettingsRepository;
	llmSettingsRepository?: LlmSettingsRepository;
};

export function createSettingsRoute(deps: SettingsRouteDeps) {
	if (!deps?.settingsRepository) {
		throw new Error("settingsRepository is not configured");
	}
	const repo = deps.settingsRepository;
	const llmRepo = deps.llmSettingsRepository;

	return new Hono()
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
		.put("/llm", async (c) => {
			if (!llmRepo) {
				return c.json(
					{ ok: false, message: "LLM settings are not configured." },
					500,
				);
			}
			const payload = await c.req.json();
			try {
				return c.json(await llmRepo.updateSettings(payload));
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
			const apiKey =
				endpoint.apiKey ||
				(endpoint.kind === "azure"
					? env.azureOpenAiApiKey
					: endpoint.kind === "openai"
						? env.openAiApiKey
						: undefined);
			const result = await checkLlmProviderHealth(endpoint, { apiKey });
			await llmRepo.recordHealthCheck(endpoint.id, result);
			return c.json(result);
		});
}
