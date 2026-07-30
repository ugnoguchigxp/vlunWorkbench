import path from "node:path";
import {
	authorizeProjectPath,
	ProjectPathPolicyError,
} from "../../../security/project-path-policy";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import type { ProjectRepository } from "../../scans/repositories";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";

export type ResolvedNightworkersProject = {
	project: NonNullable<
		Awaited<ReturnType<ProjectRepository["findByCanonicalRepoPath"]>>
	>;
	canonicalPath: string;
	created: boolean;
};

export async function resolveNightworkersProject(params: {
	projectPath: string;
	client: AuthenticatedIntegrationClient;
	projectRepository: ProjectRepository;
	globalAllowedRoots: readonly string[];
	autoCreateProjects: boolean;
}): Promise<ResolvedNightworkersProject> {
	if (!path.isAbsolute(params.projectPath)) {
		throw new NightworkersIntegrationError(
			"project_path_denied",
			"Project path must be absolute.",
		);
	}
	let canonicalPath: string;
	try {
		const globalAuthorization = await authorizeProjectPath({
			projectPath: params.projectPath,
			allowedRoots: params.globalAllowedRoots,
		});
		canonicalPath = globalAuthorization.canonicalPath;
		if (params.client.allowedRoots.length > 0) {
			await authorizeProjectPath({
				projectPath: canonicalPath,
				allowedRoots: params.client.allowedRoots,
			});
		}
	} catch (error) {
		if (error instanceof ProjectPathPolicyError) {
			throw new NightworkersIntegrationError(
				"project_path_denied",
				"The requested project path is not permitted.",
			);
		}
		throw error;
	}

	const existing =
		await params.projectRepository.findByCanonicalRepoPath(canonicalPath);
	if (existing) {
		if (existing.ownerUserId !== params.client.ownerUserId) {
			throw new NightworkersIntegrationError(
				"project_owner_mismatch",
				"The integration client does not own this project.",
			);
		}
		return { project: existing, canonicalPath, created: false };
	}
	if (!params.autoCreateProjects) {
		throw new NightworkersIntegrationError(
			"project_not_found",
			"No registered project matches the requested path.",
		);
	}
	const project = await params.projectRepository.createProject({
		ownerUserId: params.client.ownerUserId,
		name: path.basename(canonicalPath) || "repository",
		repoPath: canonicalPath,
		canonicalRepoPath: canonicalPath,
		metadata: {
			source: "nightworkers-integration",
			autoCreated: true,
			integrationClientId: params.client.id,
		},
	});
	return { project, canonicalPath, created: true };
}
