import { Hono } from "hono";
import { listProfiles } from "../modules/scans/profiles";
import {
	listGenericStartCatalogProfileIds,
	listPublicCatalogEntries,
	resolveDefaultCatalogProfileId,
} from "../modules/scans/profile-catalog";
import { scanProfileStepId } from "../modules/scans/scan-execution-plan-builder";
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
			coverageMeasurement: "not_measured" as const,
			capabilityRequirements: p.capabilityRequirements ?? [],
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
			steps: (p.steps ?? []).map((step) => ({
				stepId: scanProfileStepId(step),
				kind: step.kind,
				adapter:
					step.kind === "static_tool"
						? step.toolId
						: step.kind === "dast"
							? step.profileId
							: step.adapter,
				displayName: step.displayName,
				required: step.required,
				timeoutSec: step.timeoutSec,
				failurePolicy: step.failurePolicy,
				...(step.kind === "static_tool" ? { toolId: step.toolId } : {}),
				...(step.kind === "dast"
					? { profileId: step.profileId, target: step.target }
					: {}),
			})),
		}));
		return c.json({
			schemaVersion: 2,
			profiles: sanitizedProfiles,
			catalogEntries: listPublicCatalogEntries(),
			genericStartCatalogProfileIds: listGenericStartCatalogProfileIds(),
			defaultProfileIds: {
				full: resolveDefaultCatalogProfileId("full"),
				working_tree: resolveDefaultCatalogProfileId("working_tree"),
				commit: resolveDefaultCatalogProfileId("commit"),
				range: resolveDefaultCatalogProfileId("range"),
			},
			preflight: { schemaVersion: 1, mode: resolveScanPreflightMode() },
		});
	});
}
