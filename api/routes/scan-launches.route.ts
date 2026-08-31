import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
	type ScanLaunchPreviewRequest,
	scanLaunchPreviewRequestSchema,
	scanLaunchPreviewSchema,
} from "../../shared/schemas/scan-launch.schema";
import type { AppEnv } from "../app/env";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { analyzeProjectCapabilities } from "../modules/project-capabilities/plugin-detector";
import { evaluateScanReadiness } from "../modules/scans/execution/scan-readiness-service";
import { getScanProfileDefinition } from "../modules/scans/profile-definitions";
import type { ProjectRepository } from "../modules/scans/repositories";

type ScanLaunchesRouteDeps = {
	projectRepository: ProjectRepository;
	resolveRuntimeEnv: () => Promise<AppEnv>;
};

function runtimeDependencySettings(
	env: AppEnv,
): Record<string, string | undefined> {
	return {
		SCAN_DOCKER_IMAGE: env.scanDockerImage,
		VULN_WORKBENCH_MAVEN_RESOLVER_IMAGE: env.mavenResolverImage,
		VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE:
			env.runtimeIsolation?.nucleiImage || undefined,
		VULN_WORKBENCH_RUNTIME_ZAP_IMAGE:
			env.runtimeIsolation?.zapImage || undefined,
		VULN_WORKBENCH_RUNTIME_SCHEMATHESIS_IMAGE:
			env.runtimeIsolation?.schemathesisImage || undefined,
	};
}

function setupActions(reasonCodes: string[]) {
	return reasonCodes.includes("docker_image_unavailable") ||
		reasonCodes.includes("docker_daemon_unavailable")
		? [
				{
					code: "prepare_runtime_scanners",
					labelKey: "scan.setup.prepare_runtime_scanners",
					href: "/settings/runtime",
					requiresAdmin: true,
				},
			]
		: [];
}

/** Canonical admission preview for every catalog profile. */
export function createScanLaunchesRoute(deps: ScanLaunchesRouteDeps) {
	return new Hono().post(
		"/:projectId/scan-launches/preview",
		zValidator("json", scanLaunchPreviewRequestSchema),
		async (c) => {
			const authUser = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			const project = await deps.projectRepository.findById(projectId);
			if (!project) throw new HttpError(404, "Project not found");
			if (project.ownerUserId !== authUser.userId) {
				throw new HttpError(403, "Forbidden");
			}
			const request = c.req.valid("json") as ScanLaunchPreviewRequest;
			const sourceInput = request.input as {
				kind?: string;
				dependencyResolution?: { mode?: string };
			};
			const registryResolutionRequested =
				request.profileId === "source-assurance" &&
				sourceInput.kind === "source_target" &&
				sourceInput.dependencyResolution?.mode === "registry";
			const technologyAnalysis = registryResolutionRequested
				? await analyzeProjectCapabilities(project.repoPath)
				: null;
			const readiness = await evaluateScanReadiness({
				profileId: request.profileId,
				target: request.target,
				input: request.input,
				settings: runtimeDependencySettings(await deps.resolveRuntimeEnv()),
				workspacePath: project.repoPath,
				mavenProjectDetected:
					technologyAnalysis?.capabilityPlan.activePluginIds.includes(
						"build.maven",
					) ?? false,
			});
			const definition = getScanProfileDefinition(request.profileId);
			const response = scanLaunchPreviewSchema.parse({
				schemaVersion: 1,
				profileId: request.profileId,
				variantId: readiness.variantId,
				engineId: definition.engineId,
				readiness: readiness.readiness,
				reasonCodes: readiness.reasonCodes,
				warningCodes: readiness.warningCodes,
				setupActions: setupActions(readiness.reasonCodes),
				resolvedTargetDigest: null,
				catalogEntryHash: readiness.catalogEntryHash,
				readinessHash: readiness.readinessHash,
				planHash: readiness.planHash,
			});
			return c.json({ preview: response });
		},
	);
}
