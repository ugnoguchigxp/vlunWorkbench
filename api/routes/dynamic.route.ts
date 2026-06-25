import path from "node:path";
import { Hono } from "hono";
import {
	runDynamicRequestSchema,
	saveDynamicProfileRequestSchema,
} from "../../shared/schemas/dynamic.schema";
import type { AppDatabase } from "../db";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import { DynamicArtifactStorage } from "../modules/dynamic/dynamic-artifact-storage";
import { DynamicRepository } from "../modules/dynamic/dynamic-repository";
import type {
	FindingRepository,
	ProjectRepository,
} from "../modules/scans/repositories";

type DynamicRouteDeps = {
	db: AppDatabase;
	findingRepository: FindingRepository;
	projectRepository: ProjectRepository;
};

export function createDynamicRoute(deps: DynamicRouteDeps) {
	const { db, findingRepository, projectRepository } = deps;
	const repo = new DynamicRepository(db);
	const route = new Hono();

	// --- Profile Configs ---

	// List project profiles (both built-in templates and stored configs)
	route.get("/projects/:projectId/dynamic-profiles", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");

		const project = await projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const configs = await repo.listConfigsForProject(projectId);
		return c.json({ configs });
	});

	// Create project profile config
	route.post("/projects/:projectId/dynamic-profiles", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");

		const project = await projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		let body: any;
		try {
			body = await c.req.json();
		} catch {
			throw new HttpError(400, "Invalid JSON body");
		}

		const parseResult = saveDynamicProfileRequestSchema.safeParse(body);
		if (!parseResult.success) {
			const message = parseResult.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ");
			throw new HttpError(400, `Validation failed: ${message}`);
		}

		// Create in DB
		const created = await repo.createConfig({
			projectId,
			profileId: parseResult.data.profileId,
			dynamicKind: parseResult.data.dynamicKind,
			displayName: parseResult.data.displayName,
			enabled: parseResult.data.enabled,
			commandJson: parseResult.data.commandJson,
			workingDirectory: parseResult.data.workingDirectory,
			timeoutSec: parseResult.data.timeoutSec,
			network: parseResult.data.network,
			memory: parseResult.data.memory,
			cpus: parseResult.data.cpus,
			writableWorkdir: parseResult.data.writableWorkdir,
			allowProjectScripts: parseResult.data.allowProjectScripts,
			expectedArtifactsJson: parseResult.data.expectedArtifactsJson,
			createdByUserId: authUser.userId,
		});

		return c.json({ config: created }, 201);
	});

	// Update project profile config
	route.patch("/projects/:projectId/dynamic-profiles/:profileId", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");
		const profileId = c.req.param("profileId");

		const project = await projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		let body: any;
		try {
			body = await c.req.json();
		} catch {
			throw new HttpError(400, "Invalid JSON body");
		}

		const partialSchema = saveDynamicProfileRequestSchema.partial();
		const parseResult = partialSchema.safeParse(body);
		if (!parseResult.success) {
			const message = parseResult.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ");
			throw new HttpError(400, `Validation failed: ${message}`);
		}

		const existing = await repo.getConfigByProfileId(projectId, profileId);
		if (!existing) {
			throw new HttpError(404, "Profile config not found");
		}

		const updated = await repo.updateConfig(existing.id, parseResult.data);
		return c.json({ config: updated });
	});

	// --- Dynamic Runs ---

	// List project runs
	route.get("/projects/:projectId/dynamic-runs", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");

		const project = await projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const runs = await repo.listRunsForProject(projectId);
		return c.json({ dynamicRuns: runs });
	});

	// Trigger project dynamic run
	route.post("/projects/:projectId/dynamic-runs", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");

		const project = await projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		let body: any;
		try {
			body = await c.req.json();
		} catch {
			throw new HttpError(400, "Invalid JSON body");
		}

		const parseResult = runDynamicRequestSchema.safeParse(body);
		if (!parseResult.success) {
			const message = parseResult.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ");
			throw new HttpError(400, `Validation failed: ${message}`);
		}

		const cliResult = await executeDynamicRunCli({
			projectId,
			profileId: parseResult.data.profileId,
			runner: parseResult.data.runner,
			dockerImage: parseResult.data.dockerImage,
			network: parseResult.data.network,
			timeoutSec: parseResult.data.timeoutSec,
			memory: parseResult.data.memory,
			cpus: parseResult.data.cpus,
		});

		return c.json(cliResult);
	});

	// List finding runs
	route.get("/findings/:findingId/dynamic-runs", async (c) => {
		const authUser = getAuthContextUser(c);
		const findingId = c.req.param("findingId");

		const finding = await findingRepository.findById(findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const runs = await repo.listRunsForFinding(findingId);
		return c.json({ dynamicRuns: runs });
	});

	// Trigger finding dynamic run
	route.post("/findings/:findingId/dynamic-runs", async (c) => {
		const authUser = getAuthContextUser(c);
		const findingId = c.req.param("findingId");

		const finding = await findingRepository.findById(findingId);
		if (!finding) {
			throw new HttpError(404, "Finding not found");
		}

		const project = await projectRepository.findById(finding.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		let body: any;
		try {
			body = await c.req.json();
		} catch {
			throw new HttpError(400, "Invalid JSON body");
		}

		const parseResult = runDynamicRequestSchema.safeParse(body);
		if (!parseResult.success) {
			const message = parseResult.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; ");
			throw new HttpError(400, `Validation failed: ${message}`);
		}

		const cliResult = await executeDynamicRunCli({
			projectId: project.id,
			findingId,
			profileId: parseResult.data.profileId,
			runner: parseResult.data.runner,
			dockerImage: parseResult.data.dockerImage,
			network: parseResult.data.network,
			timeoutSec: parseResult.data.timeoutSec,
			memory: parseResult.data.memory,
			cpus: parseResult.data.cpus,
		});

		return c.json(cliResult);
	});

	// Get specific run
	route.get("/dynamic-runs/:dynamicRunId", async (c) => {
		const authUser = getAuthContextUser(c);
		const runId = c.req.param("dynamicRunId");

		const run = await repo.getRun(runId);
		if (!run) {
			throw new HttpError(404, "Dynamic run not found");
		}

		const project = await projectRepository.findById(run.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		return c.json({ dynamicRun: run });
	});

	// Get run artifacts and evidence
	route.get("/dynamic-runs/:dynamicRunId/artifacts", async (c) => {
		const authUser = getAuthContextUser(c);
		const runId = c.req.param("dynamicRunId");

		const run = await repo.getRun(runId);
		if (!run) {
			throw new HttpError(404, "Dynamic run not found");
		}

		const project = await projectRepository.findById(run.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const artifacts = await repo.listArtifacts(runId);
		const evidence = await repo.listEvidence(runId);

		return c.json({ artifacts, evidence });
	});

	// Get specific artifact file content
	route.get("/dynamic-runs/:dynamicRunId/artifacts/:artifactId", async (c) => {
		const authUser = getAuthContextUser(c);
		const runId = c.req.param("dynamicRunId");
		const artifactId = c.req.param("artifactId");

		const run = await repo.getRun(runId);
		if (!run) {
			throw new HttpError(404, "Dynamic run not found");
		}

		const project = await projectRepository.findById(run.projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const artifacts = await repo.listArtifacts(runId);
		const artifact = artifacts.find((a) => a.id === artifactId);
		if (!artifact) {
			throw new HttpError(404, "Artifact not found");
		}

		const storage = new DynamicArtifactStorage();
		const content = await storage.readDynamicTextArtifact(artifact.path);

		c.header(
			"Content-Disposition",
			`attachment; filename="${path.basename(artifact.path)}"`,
		);
		if (artifact.format === "json") {
			return c.json(JSON.parse(content));
		}
		return c.text(content);
	});

	return route;
}

// Subprocess execution wrapper to decouple api routes from docker details
async function executeDynamicRunCli(params: {
	projectId: string;
	findingId?: string | null;
	profileId: string;
	runner: string;
	dockerImage?: string;
	network?: string;
	timeoutSec?: number;
	memory?: string;
	cpus?: string;
}) {
	const args = [
		"run",
		"api/cli/dynamic-run.ts",
		"--",
		"--project-id",
		params.projectId,
		"--profile",
		params.profileId,
		"--runner",
		params.runner,
	];

	if (params.findingId) {
		args.push("--finding-id", params.findingId);
	}
	if (params.dockerImage) {
		args.push("--docker-image", params.dockerImage);
	}
	if (params.network) {
		args.push("--network", params.network);
	}
	if (params.timeoutSec !== undefined) {
		args.push("--timeout-sec", String(params.timeoutSec));
	}
	if (params.memory) {
		args.push("--memory", params.memory);
	}
	if (params.cpus) {
		args.push("--cpus", params.cpus);
	}

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
	} catch (err: any) {
		console.error(`Dynamic run CLI bridge failed: ${stderr}`);
		throw new HttpError(
			500,
			`CLI bridge parse failure: ${stderr || err.message}`,
		);
	}

	if (!cliResult.ok && !cliResult.dynamicRunId) {
		throw new HttpError(
			400,
			cliResult.message || "Failed to start dynamic run",
		);
	}

	return cliResult;
}
