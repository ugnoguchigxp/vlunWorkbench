import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { projects } from "../db/schema";
import {
	authorizeProjectPath,
	ProjectPathPolicyError,
} from "../security/project-path-policy";

type ProjectPathAuditStatus = "allowed" | "blocked" | "missing";

async function main(): Promise<void> {
	const env = readAppEnv();
	const connection = createDbConnection(env.databaseUrl);
	try {
		const rows = await connection.db
			.select({
				id: projects.id,
				name: projects.name,
				repoPath: projects.repoPath,
			})
			.from(projects);
		const audited = await Promise.all(
			rows.map(async (project) => {
				try {
					const authorized = await authorizeProjectPath({
						projectPath: project.repoPath,
						allowedRoots: env.projectAllowedRoots ?? [],
					});
					return {
						...project,
						status: "allowed" as const,
						canonicalPath: authorized.canonicalPath,
						reasonCode: null,
					};
				} catch (error) {
					const reasonCode =
						error instanceof ProjectPathPolicyError
							? error.code
							: "PROJECT_PATH_AUDIT_FAILED";
					const status: ProjectPathAuditStatus =
						reasonCode === "PROJECT_PATH_NOT_FOUND" ? "missing" : "blocked";
					return {
						...project,
						status,
						canonicalPath: null,
						reasonCode,
					};
				}
			}),
		);
		const counts = audited.reduce(
			(result, project) => {
				result[project.status] += 1;
				return result;
			},
			{ allowed: 0, blocked: 0, missing: 0 },
		);
		process.stdout.write(
			`${JSON.stringify({
				ok: true,
				policy: {
					nodeEnv: env.nodeEnv,
					configuredRootCount: env.projectAllowedRoots?.length ?? 0,
				},
				counts,
				projects: audited,
			})}\n`,
		);
	} finally {
		connection.sqlite.close(false);
	}
}

await main().catch((error) => {
	process.stdout.write(
		`${JSON.stringify({
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		})}\n`,
	);
	process.exitCode = 1;
});
