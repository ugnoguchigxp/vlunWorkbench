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
import {
	DYNAMIC_PROFILE_TEMPLATES,
	validateDynamicProfilePolicy,
} from "../modules/dynamic/dynamic-profiles";
import { DynamicRepository } from "../modules/dynamic/dynamic-repository";
import type { WebProcessCapacity } from "../modules/processes/web-process-capacity";
import type {
	FindingRepository,
	ProjectRepository,
} from "../modules/scans/repositories";
import { ScanRepository } from "../modules/scans/repositories";
import { buildDedicatedProfileMetadata } from "../modules/scans/profile-resolution";
import {
	ProjectPathPolicyError,
	resolveProjectPath,
} from "../security/project-path-policy";
import { parseCliJsonObject, runBoundedCliProcess } from "./cli-process-bridge";

const DYNAMIC_CLI_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const DYNAMIC_CLI_TIMEOUT_MS = 12 * 60 * 1000;

type DynamicRouteDeps = {
	db: AppDatabase;
	findingRepository: FindingRepository;
	projectRepository: ProjectRepository;
	processCapacity?: WebProcessCapacity;
	scanRepository?: ScanRepository;
};

type DynamicCliBridgeResult = Record<string, unknown> & {
	ok?: boolean;
	dynamicRunId?: string;
	status?: string;
	outcome?: string;
	message?: string;
};

export function createDynamicRoute(deps: DynamicRouteDeps) {
	const { db, findingRepository, projectRepository } = deps;
	const repo = new DynamicRepository(db);
	const scanRepository = deps.scanRepository ?? new ScanRepository(db);
	const route = new Hono();
	const assertExecutionPath = async (repoPath: string) => {
		try {
			await resolveProjectPath(repoPath);
		} catch (error) {
			if (error instanceof ProjectPathPolicyError) {
				throw new HttpError(400, error.message);
			}
			throw error;
		}
	};

	// --- Profile Configs ---

	// List project profiles (both built-in templates and stored configs)
	route.get("/projects/:projectId/dynamic-profiles", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");

		const project = await projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}
		const [configs, applicability] = await Promise.all([
			repo.listConfigsForProject(projectId),
			Promise.all(
				DYNAMIC_PROFILE_TEMPLATES.map(async (template) => ({
					id: template.id,
					displayName: template.displayName,
					dynamicKind: template.dynamicKind,
					applicable: await template.isApplicable(project.repoPath),
				})),
			),
		]);
		return c.json({
			configs,
			templates: applicability.filter((template) => template.applicable),
		});
	});

	// Create project profile config
	route.post("/projects/:projectId/dynamic-profiles", async (c) => {
		const authUser = getAuthContextUser(c);
		const projectId = c.req.param("projectId");

		const project = await projectRepository.findById(projectId);
		if (!project || project.ownerUserId !== authUser.userId) {
			throw new HttpError(403, "Forbidden");
		}
		let body: unknown;
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

		const policyValidation = validateDynamicProfilePolicy(parseResult.data);
		if (!policyValidation.valid) {
			throw new HttpError(
				400,
				`Profile command policy validation failed: ${policyValidation.reason}`,
			);
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
		let body: unknown;
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

		const candidate = {
			commandJson: existing.commandJson,
			allowProjectScripts: existing.allowProjectScripts,
			workingDirectory: existing.workingDirectory,
			expectedArtifactsJson: existing.expectedArtifactsJson,
			timeoutSec: existing.timeoutSec,
			network: existing.network,
			...parseResult.data,
		};
		const policyValidation = validateDynamicProfilePolicy(candidate);
		if (!policyValidation.valid) {
			throw new HttpError(
				400,
				`Profile command policy validation failed: ${policyValidation.reason}`,
			);
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
		await assertExecutionPath(project.repoPath);

		let body: unknown;
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
		if (!parseResult.data.consentProjectCodeExecution) {
			throw new HttpError(
				400,
				"Explicit consent is required for isolated project code execution.",
			);
		}

		await ensureBuiltinProfileConfig({
			repository: repo,
			projectId,
			repoPath: project.repoPath,
			profileId: parseResult.data.profileId,
			createdByUserId: authUser.userId,
		});
		const scan = await scanRepository.createScanRun({
			projectId,
			profile: "dynamic-verification",
			status: "running",
			createdByUserId: authUser.userId,
			metadata: {
				...buildDedicatedProfileMetadata({
					canonicalProfileId: "dynamic-verification",
					providedInputKinds: ["source_target", "execution_consent"],
				}),
				dynamicProfileId: parseResult.data.profileId,
				safetyBoundary: "docker-isolated-readonly-source",
				networkMode: parseResult.data.network ?? "none",
			},
		});
		try {
			const cliResult = await executeDynamicRunCli({
				projectId,
				scanRunId: scan.id,
				profileId: parseResult.data.profileId,
				runner: parseResult.data.runner,
				dockerImage: parseResult.data.dockerImage,
				network: parseResult.data.network,
				timeoutSec: parseResult.data.timeoutSec,
				memory: parseResult.data.memory,
				cpus: parseResult.data.cpus,
				executionConsent: true,
				processCapacity: deps.processCapacity,
			});
			const completed = cliResult.ok === true;
			const profileOutcome = completed
				? cliResult.outcome === "passed"
					? "completed"
					: "completed_with_warnings"
				: "failed";
			await scanRepository.updateScanRunStatus(
				scan.id,
				completed ? "completed" : "failed",
				{
					summary: completed
						? `Isolated dynamic verification completed with outcome: ${cliResult.outcome ?? "unknown"}.`
						: String(cliResult.message ?? "Dynamic verification failed."),
					profileOutcome,
					metadata: {
						dynamicRunId: cliResult.dynamicRunId ?? null,
						dynamicStatus: cliResult.status ?? null,
						dynamicOutcome: cliResult.outcome ?? null,
					},
				},
			);
			return c.json({ ...cliResult, scanRunId: scan.id });
		} catch (error) {
			await scanRepository.updateScanRunStatus(scan.id, "failed", {
				summary: error instanceof Error ? error.message : String(error),
				profileOutcome: "failed",
			});
			throw error;
		}
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
		await assertExecutionPath(project.repoPath);

		let body: unknown;
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
		if (!parseResult.data.consentProjectCodeExecution) {
			throw new HttpError(
				400,
				"Explicit consent is required for isolated project code execution.",
			);
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
			executionConsent: true,
			processCapacity: deps.processCapacity,
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
	scanRunId?: string;
	findingId?: string | null;
	profileId: string;
	runner: string;
	dockerImage?: string;
	network?: string;
	timeoutSec?: number;
	memory?: string;
	cpus?: string;
	executionConsent: true;
	processCapacity?: WebProcessCapacity;
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
		"--consent-project-code-execution",
		String(params.executionConsent),
	];
	if (params.scanRunId) args.push("--scan-run-id", params.scanRunId);

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

	const processResult = await runBoundedCliProcess({
		argv: ["bun", ...args],
		processCapacity: params.processCapacity,
		timeoutMs: DYNAMIC_CLI_TIMEOUT_MS,
		outputLimitBytes: DYNAMIC_CLI_OUTPUT_LIMIT_BYTES,
		label: "Dynamic CLI",
	});

	const cliResult = parseCliJsonObject(
		processResult,
		"Dynamic CLI",
	) as DynamicCliBridgeResult;

	if (!cliResult.ok && !cliResult.dynamicRunId) {
		throw new HttpError(
			400,
			cliResult.message || "Failed to start dynamic run",
		);
	}

	return cliResult;
}

async function ensureBuiltinProfileConfig(params: {
	repository: DynamicRepository;
	projectId: string;
	repoPath: string;
	profileId: string;
	createdByUserId: string;
}) {
	const existing = await params.repository.getConfigByProfileId(
		params.projectId,
		params.profileId,
	);
	if (existing) return existing;
	const template = DYNAMIC_PROFILE_TEMPLATES.find(
		(candidate) => candidate.id === params.profileId,
	);
	if (!template || !(await template.isApplicable(params.repoPath))) {
		throw new HttpError(
			400,
			`Dynamic profile is not applicable: ${params.profileId}`,
		);
	}
	return await params.repository.createConfig({
		projectId: params.projectId,
		profileId: template.id,
		dynamicKind: template.dynamicKind,
		displayName: template.displayName,
		enabled: true,
		commandJson: template.commandJson,
		workingDirectory: "",
		timeoutSec: template.timeoutSec,
		network: template.network,
		memory: null,
		cpus: null,
		writableWorkdir: template.writableWorkdir,
		allowProjectScripts: template.allowProjectScripts,
		expectedArtifactsJson: template.expectedArtifactsJson ?? [],
		createdByUserId: params.createdByUserId,
	});
}
