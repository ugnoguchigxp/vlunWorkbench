import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getAuthContextUser } from "../modules/auth/context";
import type { SettingsRepository } from "../modules/settings/settings.repository";

const UpdateSystemContextSchema = z.object({
	systemContext: z.string(),
});

type SettingsRouteDeps = {
	settingsRepository: SettingsRepository;
};

export function createSettingsRoute(deps: SettingsRouteDeps) {
	if (!deps?.settingsRepository) {
		throw new Error("settingsRepository is not configured");
	}
	const repo = deps.settingsRepository;

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
		);
}
