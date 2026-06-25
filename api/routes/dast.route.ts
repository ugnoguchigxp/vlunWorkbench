import path from "node:path";
import { Hono } from "hono";
import {
	runDastRequestSchema,
	saveDastProfileRequestSchema,
	saveDastTargetRequestSchema,
} from "../../shared/schemas/dast.schema";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { DastArtifactStorage } from "../modules/dast/dast-artifact-storage";
import { DastRepository } from "../modules/dast/dast-repository";
import { listDastProfiles } from "../modules/dast/profiles";
import { validateDastTargetConfig } from "../modules/dast/target-validator";
import type { ProjectRepository } from "../modules/scans/repositories";

type DastRouteDeps = {
	db: AppDatabase;
	projectRepository: ProjectRepository;
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
		const target = await repo.getTargetConfig(parsed.data.targetConfigId);
		if (!target || target.projectId !== projectId) {
			throw new HttpError(404, "DAST target config not found");
		}
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
		return c.json({ dastRuns: runs });
	});

	route.post("/projects/:projectId/dast-runs", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		await assertProjectOwner(projectId, authUser.userId);
		const body = await readJson(c.req);
		const parsed = runDastRequestSchema.safeParse(body);
		if (!parsed.success) {
			throw new HttpError(400, validationMessage(parsed.error));
		}
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
		const cliResult = await executeDastCli({
			projectId,
			...parsed.data,
		});
		return c.json(cliResult);
	});

	route.get("/dast-runs/:dastRunId", async (c) => {
		const authUser = getAuthContextUser(c);
		const run = await repo.getRun(c.req.param("dastRunId"));
		if (!run) throw new HttpError(404, "DAST run not found");
		await assertProjectOwner(run.projectId, authUser.userId);
		return c.json({ dastRun: run });
	});

	route.get("/dast-runs/:dastRunId/artifacts", async (c) => {
		const authUser = getAuthContextUser(c);
		const run = await repo.getRun(c.req.param("dastRunId"));
		if (!run) throw new HttpError(404, "DAST run not found");
		await assertProjectOwner(run.projectId, authUser.userId);
		const artifacts = await repo.listArtifacts(run.id);
		const evidence = await repo.listEvidence(run.id);
		return c.json({ artifacts, evidence });
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
			return c.body(content as any);
		}
		if (artifact.format === "json") {
			return c.json(JSON.parse(content.toString("utf8")));
		}
		return c.text(content.toString("utf8"));
	});

	return route;
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

async function executeDastCli(params: {
	projectId: string;
	targetConfigId: string;
	profileId: string;
	profileConfigId?: string;
	scanRunId?: string;
	runner?: "host" | "docker" | "mock";
	dockerImage?: string;
	timeoutSec?: number;
	maxRequests?: number;
	dryRun?: boolean;
}) {
	const args = [
		"run",
		"api/cli/scan-dast.ts",
		"--",
		"--project-id",
		params.projectId,
		"--target-config-id",
		params.targetConfigId,
		"--profile",
		params.profileId,
	];
	if (params.profileConfigId)
		args.push("--profile-config-id", params.profileConfigId);
	if (params.scanRunId) args.push("--scan-run-id", params.scanRunId);
	if (params.runner) args.push("--runner", params.runner);
	if (params.dockerImage) args.push("--docker-image", params.dockerImage);
	if (params.timeoutSec !== undefined)
		args.push("--timeout-sec", String(params.timeoutSec));
	if (params.maxRequests !== undefined)
		args.push("--max-requests", String(params.maxRequests));
	if (params.dryRun) args.push("--dry-run", "true");

	const proc = Bun.spawn(["bun", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdoutBuf, stderrBuf] = await Promise.all([
		new Response(proc.stdout).arrayBuffer(),
		new Response(proc.stderr).arrayBuffer(),
	]);
	const stdout = new TextDecoder().decode(stdoutBuf);
	const stderr = new TextDecoder().decode(stderrBuf);
	await proc.exited;

	let cliResult: any;
	try {
		cliResult = JSON.parse(stdout.trim());
	} catch (error) {
		console.error(`DAST CLI bridge failed: ${stderr}`);
		throw new HttpError(
			500,
			`CLI bridge parse failure: ${stderr || (error as Error).message}`,
		);
	}
	if (!cliResult.ok && !cliResult.dastRunId) {
		throw new HttpError(400, cliResult.message || "Failed to start DAST run");
	}
	return cliResult;
}
