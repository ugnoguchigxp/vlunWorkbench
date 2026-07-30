import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import type { AppEnv } from "../app/env";
import type { AppDatabase } from "../db";
import { attackSurfaceItems } from "../db/schema";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import type { ProjectRepository } from "../modules/scans/repositories";
import { buildApplicationModel } from "../modules/threat-models/application-model-builder";
import { readProjectModelSources } from "../modules/threat-models/project-source-reader";
import { readProjectSupplementalModelEvidence } from "../modules/threat-models/project-model-evidence-reader";
import { generateThreatHypotheses } from "../modules/threat-models/threat-hypothesis-runner";
import { ThreatModelRepository } from "../modules/threat-models/threat-model-repository";

export function createThreatModelsRoute(deps: {
	db: AppDatabase;
	env: AppEnv;
	projectRepository: ProjectRepository;
}) {
	const route = new Hono();
	const repository = new ThreatModelRepository(deps.db);
	const buildCurrentModel = async (project: {
		id: string;
		repoPath: string;
		canonicalRepoPath: string | null;
	}) => {
		const projectRoot = project.canonicalRepoPath ?? project.repoPath;
		const [sources, supplemental, runtimeItems] = await Promise.all([
			readProjectModelSources(projectRoot),
			readProjectSupplementalModelEvidence(projectRoot),
			deps.db
				.select()
				.from(attackSurfaceItems)
				.where(
					and(
						eq(attackSurfaceItems.projectId, project.id),
						eq(attackSurfaceItems.category, "api_route"),
					),
				)
				.orderBy(desc(attackSurfaceItems.createdAt))
				.limit(1_000),
		]);
		if (sources.length === 0)
			throw new HttpError(409, "No supported source files were found");
		const runtimeRoutes = runtimeItems.flatMap((item) => {
			const match = item.name.match(
				/^(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\s+(\/\S*)$/,
			);
			return match
				? [
						{
							method: match[1] as
								| "GET"
								| "HEAD"
								| "OPTIONS"
								| "POST"
								| "PUT"
								| "PATCH"
								| "DELETE",
							path: match[2],
							ref: `attack-surface:${item.id}`,
						},
					]
				: [];
		});
		return buildApplicationModel({
			projectId: project.id,
			sources,
			...supplemental,
			runtimeRoutes,
		});
	};

	const ownedProject = async (projectId: string, ownerUserId: string) => {
		const project = await deps.projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== ownerUserId)
			throw new HttpError(403, "Forbidden");
		return project;
	};

	route.get("/projects/:projectId/threat-model-runs", async (c) => {
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		const project = await ownedProject(projectId, user.userId);
		const currentSourceFingerprint = (await buildCurrentModel(project))
			.sourceFingerprint;
		const runs = await repository.listOwnedRuns(projectId, user.userId);
		const details = await Promise.all(
			runs.map((run) => repository.findOwnedRun(run.id, user.userId)),
		);
		return c.json({
			runs: runs.map((run, index) => ({
				...run,
				current:
					details[index]?.snapshot?.sourceFingerprint ===
					currentSourceFingerprint,
			})),
			currentSourceFingerprint,
		});
	});
	route.get("/threat-model-runs/:runId", async (c) => {
		const user = getAuthContextUser(c);
		const result = await repository.findOwnedRun(
			c.req.param("runId"),
			user.userId,
		);
		if (!result) throw new HttpError(404, "Threat model run not found");
		return c.json(result);
	});
	route.post("/projects/:projectId/threat-model-runs", async (c) => {
		if (!deps.env.threatModelEnabled)
			throw new HttpError(409, "Threat model capability is disabled");
		const user = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		const project = await ownedProject(projectId, user.userId);
		const model = await buildCurrentModel(project);
		const snapshot = await repository.saveSnapshot({
			model,
			ownerUserId: user.userId,
		});
		if (!snapshot) throw new HttpError(500, "Failed to save application model");
		const run = await repository.createRun({
			projectId,
			modelSnapshotId: snapshot.id,
			ownerUserId: user.userId,
		});
		try {
			const generated = await generateThreatHypotheses({ model });
			const result = await repository.completeRun({
				runId: run.id,
				modelSnapshotId: snapshot.id,
				...generated,
			});
			return c.json(result, 201);
		} catch (error) {
			await repository.failRun(
				run.id,
				error instanceof Error ? error.message : "threat_model_failed",
			);
			throw error;
		}
	});
	return route;
}
