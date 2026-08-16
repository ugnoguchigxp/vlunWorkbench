import { randomUUID } from "node:crypto";
import path from "node:path";
import { Hono } from "hono";
import {
	runDastRequestSchema,
	type SaveDastProfileRequestInput,
	type SaveDastTargetRequestInput,
	saveDastProfileRequestSchema,
	saveDastTargetRequestSchema,
} from "../../shared/schemas/dast.schema";
import { EMPTY_DAST_COVERAGE_SUMMARY } from "../../shared/schemas/dast-coverage.schema";
import type { AppEnv } from "../app/env";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { DastArtifactStorage } from "../modules/dast/dast-artifact-storage";
import { DastRepository } from "../modules/dast/dast-repository";
import { getDastProfile, listDastProfiles } from "../modules/dast/profiles";
import {
	isPathAllowed,
	validateDastTargetConfig,
} from "../modules/dast/target-validator";
import type { ProjectRepository } from "../modules/scans/repositories";
import type { WebProcessCapacity } from "../modules/processes/web-process-capacity";
import {
	ProjectPathPolicyError,
	resolveProjectPath,
} from "../security/project-path-policy";
import { executeDastCli } from "./dast-cli-bridge";

type DastRouteDeps = {
	db: AppDatabase;
	projectRepository: ProjectRepository;
	env?: AppEnv;
	processCapacity?: WebProcessCapacity;
};

export function createDastRoute(deps: DastRouteDeps) {
	const repo = new DastRepository(deps.db);
	const route = new Hono();

	async function assertProjectOwner(projectId: string, userId: string) {
		const project = await deps.projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== userId) {
			throw new HttpError(403, "Forbidden");
		}
		return project;
	}

	async function assertExecutionPath(repoPath: string) {
		try {
			await resolveProjectPath(repoPath);
		} catch (error) {
			if (error instanceof ProjectPathPolicyError) {
				throw new HttpError(400, error.message);
			}
			throw error;
		}
	}

	route.get("/projects/:projectId/dast-targets", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, authUser.userId);
		const targets = await repo.listTargetConfigsForProject(projectId);
		return c.json({ targets });
	});

	route.post("/projects/:projectId/dast-targets", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, authUser.userId);
		const body = await readJson(c.req);
		const parsed = saveDastTargetRequestSchema.safeParse(body);
		if (!parsed.success) {
			throw new HttpError(400, validationMessage(parsed.error));
		}
		await assertTargetIsPersistable(projectId, parsed.data);
		const created = await repo.createTargetConfig({
			projectId,
			...parsed.data,
			createdByUserId: authUser.userId,
		});
		const validation = await validateDastTargetConfig(created);
		return c.json({ target: created, validation }, 201);
	});

	route.patch(
		"/projects/:projectId/dast-targets/:targetConfigId",
		async (c) => {
			const authUser = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			const targetConfigId = c.req.param("targetConfigId");
			await assertProjectOwner(projectId, authUser.userId);
			const body = await readJson(c.req);
			const parsed = saveDastTargetRequestSchema.partial().safeParse(body);
			if (!parsed.success) {
				throw new HttpError(400, validationMessage(parsed.error));
			}
			const existing = await repo.getTargetConfig(targetConfigId);
			if (!existing || existing.projectId !== projectId) {
				throw new HttpError(404, "DAST target config not found");
			}
			await assertTargetIsPersistable(projectId, parsed.data, existing);
			const updated = await repo.updateTargetConfig(
				targetConfigId,
				parsed.data,
			);
			if (!updated) throw new HttpError(404, "DAST target config not found");
			const validation = await validateDastTargetConfig(updated);
			return c.json({ target: updated, validation });
		},
	);

	route.get("/projects/:projectId/dast-profiles", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, authUser.userId);
		const configs = await repo.listProfileConfigsForProject(projectId);
		return c.json({ profiles: listDastProfiles(), configs });
	});

	route.post("/projects/:projectId/dast-profiles", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, authUser.userId);
		const body = await readJson(c.req);
		const parsed = saveDastProfileRequestSchema.safeParse(body);
		if (!parsed.success) {
			throw new HttpError(400, validationMessage(parsed.error));
		}
		if (
			deps.env?.dastStandardV2Enabled === false &&
			parsed.data.profileId.includes("standard")
		) {
			throw new HttpError(409, "DAST standard v2 is disabled.");
		}
		const target = await repo.getTargetConfig(parsed.data.targetConfigId);
		if (!target || target.projectId !== projectId) {
			throw new HttpError(404, "DAST target config not found");
		}
		assertProfileConfigIsPersistable(parsed.data, target);
		const created = await repo.createProfileConfig({
			projectId,
			...parsed.data,
			createdByUserId: authUser.userId,
		});
		return c.json({ config: created }, 201);
	});

	route.patch(
		"/projects/:projectId/dast-profiles/:profileConfigId",
		async (c) => {
			const authUser = getAuthContextUser(c);
			const projectId = c.req.param("projectId");
			const profileConfigId = c.req.param("profileConfigId");
			await assertProjectOwner(projectId, authUser.userId);
			const body = await readJson(c.req);
			const parsed = saveDastProfileRequestSchema.partial().safeParse(body);
			if (!parsed.success) {
				throw new HttpError(400, validationMessage(parsed.error));
			}
			const existing = await repo.getProfileConfig(profileConfigId);
			if (!existing || existing.projectId !== projectId) {
				throw new HttpError(404, "DAST profile config not found");
			}
			const merged = { ...existing, ...parsed.data };
			const target = await repo.getTargetConfig(merged.targetConfigId);
			if (!target || target.projectId !== projectId) {
				throw new HttpError(404, "DAST target config not found");
			}
			assertProfileConfigIsPersistable(
				{
					targetConfigId: merged.targetConfigId,
					profileId: merged.profileId,
					displayName: merged.displayName,
					enabled: merged.enabled,
					routePathsJson: merged.routePathsJson,
					formSelectorsJson: merged.formSelectorsJson,
					checkOptionsJson: merged.checkOptionsJson,
					timeoutSec: merged.timeoutSec,
					maxRequests: merged.maxRequests,
					metadata: merged.metadata,
				},
				target,
			);
			const updated = await repo.updateProfileConfig(
				profileConfigId,
				parsed.data,
			);
			return c.json({ config: updated });
		},
	);

	route.get("/projects/:projectId/dast-runs", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, authUser.userId);
		const runs = await repo.listRunsForProject(projectId);
		return c.json({ dastRuns: runs.map(presentDastRun) });
	});

	route.post("/projects/:projectId/dast-runs", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		const project = await assertProjectOwner(projectId, authUser.userId);
		await assertExecutionPath(project.repoPath);
		const body = await readJson(c.req);
		const parsed = runDastRequestSchema.safeParse(body);
		if (!parsed.success) {
			throw new HttpError(400, validationMessage(parsed.error));
		}
		if (
			deps.env?.dastStandardV2Enabled === false &&
			parsed.data.profileId.includes("standard")
		) {
			throw new HttpError(409, "DAST standard v2 is disabled.");
		}
		if (parsed.data.targetConfigId) {
			const target = await repo.getTargetConfig(parsed.data.targetConfigId);
			if (!target || target.projectId !== projectId) {
				throw new HttpError(404, "DAST target config not found");
			}
			const validation = await validateDastTargetConfig(target, {
				runner: parsed.data.runner,
			});
			if (!validation.ok) {
				throw new HttpError(400, validation.message);
			}
		}
		const cliResult = await executeDastCli({
			projectId,
			...parsed.data,
			createdByUserId: authUser.userId,
			processCapacity: deps.processCapacity,
		});
		return c.json(cliResult);
	});

	route.get("/dast-runs/:dastRunId", async (c) => {
		const authUser = getAuthContextUser(c);
		const run = await repo.getRun(c.req.param("dastRunId"));
		if (!run) throw new HttpError(404, "DAST run not found");
		await assertProjectOwner(run.projectId, authUser.userId);
		return c.json({ dastRun: presentDastRun(run) });
	});

	route.get("/dast-runs/:dastRunId/artifacts", async (c) => {
		const authUser = getAuthContextUser(c);
		const run = await repo.getRun(c.req.param("dastRunId"));
		if (!run) throw new HttpError(404, "DAST run not found");
		await assertProjectOwner(run.projectId, authUser.userId);
		const artifacts = await repo.listArtifacts(run.id);
		const evidence = await repo.listEvidence(run.id);
		const routeInventory = await repo.listRouteInventory(run.id);
		return c.json({ artifacts, evidence, routeInventory });
	});

	route.get("/dast-runs/:dastRunId/artifacts/:artifactId", async (c) => {
		const authUser = getAuthContextUser(c);
		const run = await repo.getRun(c.req.param("dastRunId"));
		if (!run) throw new HttpError(404, "DAST run not found");
		await assertProjectOwner(run.projectId, authUser.userId);
		const artifacts = await repo.listArtifacts(run.id);
		const artifact = artifacts.find(
			(item) => item.id === c.req.param("artifactId"),
		);
		if (!artifact) throw new HttpError(404, "Artifact not found");
		const storage = new DastArtifactStorage();
		const content = await storage.readArtifact(artifact.path);
		c.header(
			"Content-Disposition",
			`attachment; filename="${path.basename(artifact.path)}"`,
		);
		if (artifact.format === "png") {
			c.header("Content-Type", "image/png");
			return c.body(new Uint8Array(content));
		}
		if (artifact.format === "json") {
			return c.json(JSON.parse(content.toString("utf8")));
		}
		return c.text(content.toString("utf8"));
	});

	return route;
}

async function assertTargetIsPersistable(
	projectId: string,
	input: Partial<SaveDastTargetRequestInput>,
	existing?: {
		id: string;
		name: string;
		origin: string;
		enabled: boolean;
		allowLoopback: boolean;
		allowPrivateNetwork: boolean;
		allowedPathsJson: string[];
		excludedPathsJson: string[];
		defaultHeadersJson: Record<string, string>;
		maxDepth: number;
		maxRequests: number;
		rateLimitPerSec: number;
		timeoutSec: number;
		metadata: Record<string, unknown>;
		createdByUserId: string | null;
		createdAt: string | Date;
		updatedAt: string | Date;
	},
) {
	const now = new Date();
	const candidate = {
		id: existing?.id ?? randomUUID(),
		projectId,
		name: input.name ?? existing?.name ?? "DAST target",
		origin: input.origin ?? existing?.origin ?? "",
		normalizedOrigin: input.origin ?? existing?.origin ?? "http://127.0.0.1",
		enabled: true,
		allowLoopback: input.allowLoopback ?? existing?.allowLoopback ?? true,
		allowPrivateNetwork:
			input.allowPrivateNetwork ?? existing?.allowPrivateNetwork ?? false,
		allowedPathsJson: input.allowedPathsJson ??
			existing?.allowedPathsJson ?? ["/"],
		excludedPathsJson:
			input.excludedPathsJson ?? existing?.excludedPathsJson ?? [],
		defaultHeadersJson:
			input.defaultHeadersJson ?? existing?.defaultHeadersJson ?? {},
		maxDepth: input.maxDepth ?? existing?.maxDepth ?? 0,
		maxRequests: input.maxRequests ?? existing?.maxRequests ?? 20,
		rateLimitPerSec: input.rateLimitPerSec ?? existing?.rateLimitPerSec ?? 2,
		timeoutSec: input.timeoutSec ?? existing?.timeoutSec ?? 120,
		metadata: input.metadata ?? existing?.metadata ?? {},
		createdByUserId: existing?.createdByUserId ?? null,
		createdAt: existing?.createdAt ?? now,
		updatedAt: existing?.updatedAt ?? now,
	};
	const validation = await validateDastTargetConfig(candidate);
	if (!validation.ok) {
		throw new HttpError(400, validation.message);
	}
}

function assertProfileConfigIsPersistable(
	input: SaveDastProfileRequestInput,
	target: {
		allowedPathsJson: string[];
		excludedPathsJson: string[];
	},
) {
	const profile = getDastProfile(input.profileId);
	if (!profile) {
		throw new HttpError(400, `DAST profile not found: ${input.profileId}`);
	}
	if (!profile.enabled && input.enabled !== false) {
		throw new HttpError(400, `DAST profile is disabled: ${input.profileId}`);
	}
	const routes = input.routePathsJson ?? [];
	for (const routePath of routes) {
		if (
			!isPathAllowed({
				path: routePath,
				allowedPaths: target.allowedPathsJson.length
					? target.allowedPathsJson
					: ["/"],
				excludedPaths: target.excludedPathsJson,
			})
		) {
			throw new HttpError(
				400,
				`DAST profile route path is outside target scope: ${routePath}`,
			);
		}
	}
	if (
		input.enabled !== false &&
		profile.requiresRoutes &&
		routes.length === 0
	) {
		throw new HttpError(
			400,
			`DAST profile requires configured route paths: ${profile.id}`,
		);
	}
	if (
		input.enabled !== false &&
		profile.requiresForms &&
		(input.formSelectorsJson ?? []).length === 0
	) {
		throw new HttpError(
			400,
			`DAST profile requires configured form selectors: ${profile.id}`,
		);
	}
}

async function readJson(req: { json(): Promise<unknown> }): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		throw new HttpError(400, "Invalid JSON body");
	}
}

function validationMessage(error: {
	issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
	return `Validation failed: ${error.issues
		.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
		.join("; ")}`;
}

function presentDastRun<
	T extends {
		status: string;
		verdict: string | null;
		coverageStatus: string | null;
		coverageSummary: Record<string, unknown>;
		limitationCodes: string[];
	},
>(run: T) {
	const terminal = ["completed", "failed", "timed_out", "cancelled"].includes(
		run.status,
	);
	if (!terminal || run.verdict !== null) return run;
	return {
		...run,
		verdict: "unknown_legacy" as const,
		coverageStatus: "gap" as const,
		coverageSummary:
			Object.keys(run.coverageSummary).length > 0
				? run.coverageSummary
				: EMPTY_DAST_COVERAGE_SUMMARY,
		limitationCodes: [
			...new Set([...run.limitationCodes, "unknown_legacy_coverage"]),
		],
	};
}
