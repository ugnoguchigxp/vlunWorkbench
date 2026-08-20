import { Hono } from "hono";
import { listProfiles } from "../modules/scans/profiles";
import { resolveScanPreflightMode } from "../modules/scans/scan-preflight";

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
			strictness: p.strictness ?? "best_effort",
			defaultTimeoutSec: p.defaultTimeoutSec,
			supportedTargets: p.supportedTargets ?? ["full"],
			coverageGaps: p.coverageGaps ?? [],
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
			steps: p.steps?.map((step) => {
				if (step.kind === "dast") {
					return {
						kind: step.kind,
						profileId: step.profileId,
						displayName: step.displayName,
						required: step.required,
						timeoutSec: step.timeoutSec,
						failurePolicy: step.failurePolicy,
						target: step.target,
					};
				}
				return {
					kind: step.kind,
					toolId: step.kind === "static_tool" ? step.toolId : step.adapter,
					displayName: step.displayName,
					required: step.required,
					timeoutSec: step.timeoutSec,
					failurePolicy: step.failurePolicy,
				};
			}),
		}));
		return c.json({
			profiles: sanitizedProfiles,
			preflight: { schemaVersion: 1, mode: resolveScanPreflightMode() },
		});
	});
}
