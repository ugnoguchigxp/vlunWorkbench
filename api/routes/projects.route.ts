import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import fs from "node:fs/promises";
import path from "node:path";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { ProjectRepository } from "../modules/scans/repositories";
import { createProjectSchema } from "../../shared/schemas/scan.schema";

type ProjectsRouteDeps = {
	projectRepository: ProjectRepository;
};

export function createProjectsRoute(deps: ProjectsRouteDeps) {
	const repo = deps.projectRepository;

	return new Hono()
		.get("/", async (c) => {
			const authUser = getAuthContextUser(c);
			const list = await repo.listProjects(authUser.userId);
			return c.json({ projects: list });
		})
		.get("/:projectId", async (c) => {
			const authUser = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			const project = await repo.findById(projectId);
			if (!project) {
				throw new HttpError(404, "Project not found");
			}
			if (project.ownerUserId !== authUser.userId) {
				throw new HttpError(403, "Forbidden");
			}
			return c.json({ project });
		})
		.post("/", zValidator("json", createProjectSchema), async (c) => {
			const authUser = getAuthContextUser(c);
			const body = c.req.valid("json");

			// Check repo path exists on disk
			const resolvedPath = path.resolve(body.repoPath);
			try {
				await fs.access(resolvedPath);
			} catch {
				throw new HttpError(
					400,
					`Repository path does not exist on disk: ${body.repoPath}`,
				);
			}

			// Check duplicate repo path for this user
			const existing = await repo.findByRepoPath(authUser.userId, resolvedPath);
			if (existing) {
				throw new HttpError(
					400,
					"A project with this repository path is already registered.",
				);
			}

			const created = await repo.createProject({
				ownerUserId: authUser.userId,
				name: body.name,
				repoPath: resolvedPath,
				defaultBranch: body.defaultBranch,
				metadata: body.metadata,
			});

			return c.json({ project: created }, 201);
		});
}
