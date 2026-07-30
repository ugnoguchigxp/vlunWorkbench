import { Hono } from "hono";
import {
	createDastAuthContextSchema,
	rotateDastAuthContextSchema,
} from "../../shared/schemas/dast-auth.schema";
import type { AppEnv } from "../app/env";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { DastAuthContextCrypto } from "../modules/dast/auth-context-crypto";
import { DastAuthContextRepository } from "../modules/dast/auth-context-repository";
import { DastRepository } from "../modules/dast/dast-repository";
import type { ProjectRepository } from "../modules/scans/repositories";

export function createDastAuthRoute(deps: {
	db: AppDatabase;
	env: AppEnv;
	projectRepository: ProjectRepository;
}) {
	const dastRepository = new DastRepository(deps.db);
	const route = new Hono();
	const repository = () => {
		if (!deps.env.dastAuthEncryptionKey) {
			throw new HttpError(
				409,
				"DAST_AUTH_ENCRYPTION_KEY is required for auth contexts.",
			);
		}
		return new DastAuthContextRepository(
			deps.db,
			new DastAuthContextCrypto(
				deps.env.dastAuthEncryptionKey,
				deps.env.dastAuthPreviousEncryptionKeys,
			),
		);
	};
	const assertOwner = async (projectId: string, userId: string) => {
		const project = await deps.projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== userId) {
			throw new HttpError(403, "Forbidden");
		}
	};
	const assertTarget = async (projectId: string, targetConfigId: string) => {
		const target = await dastRepository.getTargetConfig(targetConfigId);
		if (!target || target.projectId !== projectId) {
			throw new HttpError(404, "DAST target config not found");
		}
	};

	route.get("/projects/:projectId/dast-auth-contexts", async (c) => {
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertOwner(projectId, user.userId);
		return c.json({ authContexts: await repository().list(projectId) });
	});
	route.post("/projects/:projectId/dast-auth-contexts", async (c) => {
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertOwner(projectId, user.userId);
		const parsed = createDastAuthContextSchema.safeParse(await c.req.json());
		if (!parsed.success) {
			throw new HttpError(
				400,
				parsed.error.issues.map((issue) => issue.message).join("; "),
			);
		}
		await assertTarget(projectId, parsed.data.targetConfigId);
		const authContext = await repository().create({
			...parsed.data,
			projectId,
			createdByUserId: user.userId,
		});
		return c.json({ authContext }, 201);
	});
	route.post(
		"/projects/:projectId/dast-auth-contexts/:authContextId/rotate",
		async (c) => {
			const user = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			await assertOwner(projectId, user.userId);
			const parsed = rotateDastAuthContextSchema.safeParse(await c.req.json());
			if (!parsed.success) {
				throw new HttpError(
					400,
					parsed.error.issues.map((issue) => issue.message).join("; "),
				);
			}
			const authContext = await repository()
				.rotate({
					id: c.req.param("authContextId"),
					projectId,
					...parsed.data,
					actorUserId: user.userId,
				})
				.catch((error) => {
					throw new HttpError(
						409,
						error instanceof Error ? error.message : String(error),
					);
				});
			if (!authContext) throw new HttpError(404, "DAST auth context not found");
			return c.json({ authContext });
		},
	);
	route.post(
		"/projects/:projectId/dast-auth-contexts/:authContextId/revoke",
		async (c) => {
			const user = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			await assertOwner(projectId, user.userId);
			const authContext = await repository().revoke(
				c.req.param("authContextId"),
				projectId,
				user.userId,
			);
			if (!authContext) throw new HttpError(404, "DAST auth context not found");
			return c.json({ authContext });
		},
	);
	return route;
}
