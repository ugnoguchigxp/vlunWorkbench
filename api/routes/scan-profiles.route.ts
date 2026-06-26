import { Hono } from "hono";
import { listProfiles } from "../modules/scans/profiles";

export function createScanProfilesRoute() {
	return new Hono().get("/", async (c) => {
		const profiles = listProfiles();
		// Omit command or sensitive options from API response
		const sanitizedProfiles = profiles.map((p) => ({
			id: p.id,
			name: p.name,
			description: p.description,
			category: p.category,
			enabled: p.enabled,
			defaultTimeoutSec: p.defaultTimeoutSec,
			scope: p.scope
				? {
						intent: p.scope.intent,
						includeGenerated: p.scope.includeGenerated,
						includeInstalledDependencies: p.scope.includeInstalledDependencies,
						includeVendoredDependencies: p.scope.includeVendoredDependencies,
						notes: p.scope.notes,
					}
				: undefined,
			tools: p.tools.map((t) => ({
				toolId: t.toolId,
				displayName: t.displayName,
				required: t.required,
				timeoutSec: t.timeoutSec,
			})),
		}));
		return c.json({ profiles: sanitizedProfiles });
	});
}
