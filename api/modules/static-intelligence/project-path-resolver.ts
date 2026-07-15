import fs from "node:fs/promises";
import path from "node:path";
import type { AppDatabase } from "../../db";
import { projects, users } from "../../db/schema";
import { CLI_ORACLE_USER_EMAIL } from "../scans/project-resolver";
import { ProjectRepository } from "../scans/repositories";

export type ProjectPathErrorCode =
	| "PROJECT_PATH_REQUIRED"
	| "PROJECT_PATH_NOT_ABSOLUTE"
	| "PROJECT_PATH_NOT_FOUND"
	| "PROJECT_PATH_NOT_DIRECTORY"
	| "PROJECT_PATH_SYMLINK_NOT_ALLOWED"
	| "PROJECT_PATH_NOT_ALLOWED"
	| "PROJECT_PATH_UNREADABLE"
	| "PROJECT_NOT_PREPARED";

export class ProjectPathResolutionError extends Error {
	constructor(
		readonly code: ProjectPathErrorCode,
		message: string,
		readonly retryable = false,
	) {
		super(message);
		this.name = "ProjectPathResolutionError";
	}
}

export type PathResolvedProject = {
	project: Awaited<ReturnType<ProjectRepository["findById"]>>;
	projectPath: string;
	created: boolean;
};

export async function canonicalizeAllowedProjectRoots(
	roots: string[],
): Promise<string[]> {
	const canonical: string[] = [];
	for (const root of roots) {
		try {
			const real = await fs.realpath(root);
			if ((await fs.stat(real)).isDirectory()) canonical.push(real);
		} catch {
			// Invalid configured roots are ignored so the resulting policy stays fail-closed.
		}
	}
	return [...new Set(canonical)].sort((a, b) => a.localeCompare(b));
}

export async function canonicalizeProjectPath(params: {
	projectPath: string;
	allowedProjectRoots: string[];
}): Promise<string> {
	const input = params.projectPath.trim();
	if (!input || input.length > 4096 || input.includes("\0")) {
		throw new ProjectPathResolutionError(
			"PROJECT_PATH_REQUIRED",
			"projectPath must be a non-empty absolute path.",
		);
	}
	if (!path.isAbsolute(input)) {
		throw new ProjectPathResolutionError(
			"PROJECT_PATH_NOT_ABSOLUTE",
			"projectPath must be absolute.",
		);
	}

	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(input);
	} catch {
		throw new ProjectPathResolutionError(
			"PROJECT_PATH_NOT_FOUND",
			"The requested project path does not exist.",
		);
	}
	if (!stat.isDirectory()) {
		throw new ProjectPathResolutionError(
			"PROJECT_PATH_NOT_DIRECTORY",
			"The requested project path is not a directory.",
		);
	}

	let canonical: string;
	try {
		canonical = await fs.realpath(input);
		if (canonical !== path.resolve(input)) {
			throw new ProjectPathResolutionError(
				"PROJECT_PATH_SYMLINK_NOT_ALLOWED",
				"projectPath must not contain symbolic-link aliases.",
			);
		}
		await fs.access(canonical, fs.constants.R_OK | fs.constants.X_OK);
	} catch (error) {
		if (error instanceof ProjectPathResolutionError) throw error;
		throw new ProjectPathResolutionError(
			"PROJECT_PATH_UNREADABLE",
			"The requested project path is not readable.",
			true,
		);
	}
	const allowedRoots = await canonicalizeAllowedProjectRoots(
		params.allowedProjectRoots,
	);
	if (!allowedRoots.some((root) => isSameOrDescendant(root, canonical))) {
		throw new ProjectPathResolutionError(
			"PROJECT_PATH_NOT_ALLOWED",
			"The requested project path is outside the configured allowed roots.",
		);
	}
	try {
		await fs.stat(path.join(canonical, ".git"));
	} catch {
		throw new ProjectPathResolutionError(
			"PROJECT_PATH_UNREADABLE",
			"The requested project path is not a repository root.",
		);
	}
	return canonical;
}

export async function resolveStaticIntelligenceProjectByPath(params: {
	db: AppDatabase;
	projectPath: string;
	allowedProjectRoots: string[];
	createProject: boolean;
}): Promise<PathResolvedProject> {
	const projectPath = await canonicalizeProjectPath(params);
	const repository = new ProjectRepository(params.db);
	let project = await repository.findByCanonicalRepoPath(projectPath);
	if (!project) project = await repository.findAnyByRepoPath(projectPath);
	if (!project) {
		const candidates = await params.db.select().from(projects);
		for (const candidate of candidates) {
			try {
				if ((await fs.realpath(candidate.repoPath)) !== projectPath) continue;
				project = params.createProject
					? await repository.setCanonicalRepoPath(candidate.id, projectPath)
					: candidate;
				break;
			} catch {}
		}
	}
	if (project) return { project, projectPath, created: false };
	if (!params.createProject)
		return { project: null, projectPath, created: false };

	const owner = await ensureMcpProjectOwner(params.db);
	const created = await repository.createProject({
		ownerUserId: owner.id,
		name: path.basename(projectPath) || "repository",
		repoPath: projectPath,
		canonicalRepoPath: projectPath,
		metadata: { source: "static-intelligence-mcp", autoCreated: true },
	});
	return { project: created, projectPath, created: true };
}

function isSameOrDescendant(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

async function ensureMcpProjectOwner(db: AppDatabase) {
	const existing = await db.query.users.findFirst({
		where: (table, { eq: equals }) =>
			equals(table.email, CLI_ORACLE_USER_EMAIL),
	});
	if (existing) return existing;
	const now = new Date();
	const [created] = await db
		.insert(users)
		.values({
			email: CLI_ORACLE_USER_EMAIL,
			passwordHash: "mcp-project-resolver-disabled",
			displayName: "Static Intelligence MCP",
			role: "member",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		})
		.returning();
	return created;
}
