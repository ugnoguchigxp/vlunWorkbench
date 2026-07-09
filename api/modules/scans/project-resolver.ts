import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { users } from "../../db/schema";
import { ProjectRepository } from "./repositories";

export const CLI_ORACLE_USER_EMAIL = "security-oracle@vuln-workbench.local";

export class ProjectResolutionError extends Error {
	constructor(
		readonly code:
			| "PROJECT_PATH_REQUIRED"
			| "PROJECT_PATH_NOT_FOUND"
			| "PROJECT_NOT_FOUND",
		message: string,
	) {
		super(message);
		this.name = "ProjectResolutionError";
	}
}

export type ResolvedProjectByPath = {
	project: Awaited<ReturnType<ProjectRepository["createProject"]>>;
	repoPath: string;
	created: boolean;
};

async function normalizeProjectPath(projectPath: string): Promise<string> {
	const trimmed = projectPath.trim();
	if (!trimmed) {
		throw new ProjectResolutionError(
			"PROJECT_PATH_REQUIRED",
			"--project-path is required.",
		);
	}
	const absolutePath = path.resolve(trimmed);
	try {
		const stat = await fs.stat(absolutePath);
		if (!stat.isDirectory()) {
			throw new ProjectResolutionError(
				"PROJECT_PATH_NOT_FOUND",
				`Project path is not a directory: ${absolutePath}`,
			);
		}
		return await fs.realpath(absolutePath);
	} catch (error) {
		if (error instanceof ProjectResolutionError) throw error;
		throw new ProjectResolutionError(
			"PROJECT_PATH_NOT_FOUND",
			`Project path not found: ${absolutePath}`,
		);
	}
}

async function ensureCliUser(db: AppDatabase) {
	const existing = await db.query.users.findFirst({
		where: eq(users.email, CLI_ORACLE_USER_EMAIL),
	});
	if (existing) return existing;

	const now = new Date();
	const [created] = await db
		.insert(users)
		.values({
			email: CLI_ORACLE_USER_EMAIL,
			passwordHash: "cli-oracle-disabled",
			displayName: "Security Oracle CLI",
			role: "member",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return created;
}

async function resolveDefaultBranch(
	repoPath: string,
): Promise<string | undefined> {
	try {
		const proc = Bun.spawnSync(
			["git", "-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
			{
				stderr: "pipe",
				stdout: "pipe",
			},
		);
		if (!proc.success) return undefined;
		const branch = proc.stdout.toString().trim();
		return branch && branch !== "HEAD" ? branch : undefined;
	} catch {
		return undefined;
	}
}

export async function resolveProjectByPath(
	db: AppDatabase,
	projectPath: string,
	options: { createProject?: boolean } = {},
): Promise<ResolvedProjectByPath> {
	const repoPath = await normalizeProjectPath(projectPath);
	const projectRepo = new ProjectRepository(db);
	const existing = await projectRepo.findAnyByRepoPath(repoPath);
	if (existing) {
		return { project: existing, repoPath, created: false };
	}

	if (!options.createProject) {
		throw new ProjectResolutionError(
			"PROJECT_NOT_FOUND",
			`Project not found for path: ${repoPath}`,
		);
	}

	const cliUser = await ensureCliUser(db);
	const defaultBranch = await resolveDefaultBranch(repoPath);
	const project = await projectRepo.createProject({
		ownerUserId: cliUser.id,
		name: path.basename(repoPath) || "repository",
		repoPath,
		defaultBranch,
		metadata: {
			source: "cli-project-path-resolver",
			autoCreated: true,
		},
	});
	return { project, repoPath, created: true };
}
