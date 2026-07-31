import path from "node:path";
import { Hono } from "hono";
import { runReproductionRequestSchema } from "../../shared/schemas/reproduction.schema";
import { observationOutcomeToLegacy } from "../../shared/schemas/verification.schema";
import type { AppDatabase } from "../db";
import type { AppEnv } from "../app/env";
import { getAuthContextUser } from "../modules/auth/context";
import { HttpError } from "../modules/auth/errors";
import {
	getReproductionProfileById,
	listReproductionProfiles,
} from "../modules/reproductions/profiles";
import { ReproductionArtifactStorage } from "../modules/reproductions/reproduction-artifact-storage";
import { ReproductionRepository } from "../modules/reproductions/reproduction-repository";
import type {
	FindingRepository,
	ProjectRepository,
} from "../modules/scans/repositories";
import { authorizeProjectPath } from "../security/project-path-policy";

type ReproductionsRouteDeps = {
	db: AppDatabase;
	findingRepository: FindingRepository;
	projectRepository: ProjectRepository;
	env?: AppEnv;
};

export function createReproductionsRoute(deps: ReproductionsRouteDeps) {
	const { db, findingRepository, projectRepository } = deps;
	const repo = new ReproductionRepository(db);
	const route = new Hono();
	const assertExecutionPath = async (repoPath: string) => {
		if (!deps.env) return;
		try {
			await authorizeProjectPath({
				projectPath: repoPath,
				allowedRoots: deps.env.projectAllowedRoots ?? [],
			});
		} catch {
			throw new HttpError(
				403,
				"Project path is not authorized for Web execution.",
			);
		}
	};

	// Finding-specific reproduction profiles
	route.get("/findings/:findingId/reproduction-profiles", async (c) => {
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
		const allProfiles = listReproductionProfiles();
		const resolvedProfiles = allProfiles.map((p) => {
			const appCheck = p.isApplicable({ finding });
			return {
				id: p.id,
				displayName: p.displayName,
				description: p.description,
				sourceTools: p.sourceTools,
				defaultTimeoutSec: p.defaultTimeoutSec,
				defaultNetworkMode: p.defaultNetworkMode,
				isApplicable: appCheck.applicable,
				applicabilityReason: appCheck.reason || null,
			};
		});

		return c.json({ profiles: resolvedProfiles });
	});

	// Finding-specific reproduction runs list
	route.on(
		["GET"],
		[
			"/findings/:findingId/reproductions",
			"/findings/:findingId/verifications",
		],
		async (c) => {
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
			const verifications = runs;
			const reproductions = runs.map((run) => ({
				...run,
				outcome: observationOutcomeToLegacy(run.outcome),
			}));
			return c.json({ reproductions, verifications });
		},
	);

	// Trigger a finding reproduction via CLI bridge
	route.on(
		["POST"],
		[
			"/findings/:findingId/reproductions",
			"/findings/:findingId/verifications",
		],
		async (c) => {
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

			const parseResult = runReproductionRequestSchema.safeParse(body);
			if (!parseResult.success) {
				const message = parseResult.error.issues
					.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
					.join("; ");
				throw new HttpError(400, `Validation failed: ${message}`);
			}

			const {
				profileId,
				runner,
				dockerImage,
				network,
				timeoutSec,
				memory,
				cpus,
			} = parseResult.data;

			// Validate profile exists and is applicable before launching CLI
			const profile = getReproductionProfileById(profileId);
			if (!profile) {
				throw new HttpError(400, `Profile not found: ${profileId}`);
			}

			const appCheck = profile.isApplicable({ finding });
			if (!appCheck.applicable) {
				throw new HttpError(
					400,
					`Profile ${profileId} is not applicable: ${appCheck.reason}`,
				);
			}

			// Construct CLI arguments
			const args = [
				"run",
				"api/cli/repro-finding.ts",
				"--",
				"--finding-id",
				findingId,
				"--profile",
				profileId,
				"--runner",
				runner,
			];

			if (dockerImage) {
				args.push("--docker-image", dockerImage);
			}
			if (network) {
				args.push("--network", network);
			}
			if (timeoutSec !== undefined) {
				args.push("--timeout-sec", String(timeoutSec));
			}
			if (memory) {
				args.push("--memory", memory);
			}
			if (cpus) {
				args.push("--cpus", cpus);
			}

			// Run reproduction via CLI processes to ensure process safety boundary
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

			let cliResult: {
				ok?: boolean;
				reproductionRunId?: string;
				message?: string;
			};
			try {
				cliResult = JSON.parse(stdout.trim()) as typeof cliResult;
			} catch (err: unknown) {
				console.error(`CLI execution failed: ${stderr}`);
				throw new HttpError(
					500,
					`CLI bridge parse failure: ${stderr || (err instanceof Error ? err.message : String(err))}`,
				);
			}

			// If CLI failed before creating run
			if (!cliResult.ok && !cliResult.reproductionRunId) {
				throw new HttpError(
					400,
					cliResult.message || "Failed to start reproduction",
				);
			}

			// Return 200 even for failed execution run, as long as it has reproductionRunId
			return c.json(cliResult);
		},
	);

	// Get specific reproduction run details
	route.on(
		["GET"],
		[
			"/reproduction-runs/:reproductionRunId",
			"/verification-runs/:reproductionRunId",
		],
		async (c) => {
			const authUser = getAuthContextUser(c);
			const runId = c.req.param("reproductionRunId");

			const run = await repo.getRun(runId);
			if (!run) {
				throw new HttpError(404, "Reproduction run not found");
			}

			const project = await projectRepository.findById(run.projectId);
			if (!project || project.ownerUserId !== authUser.userId) {
				throw new HttpError(403, "Forbidden");
			}

			return c.json({
				reproductionRun: {
					...run,
					outcome: observationOutcomeToLegacy(run.outcome),
				},
				verificationRun: run,
			});
		},
	);

	// Get artifacts and evidence list for reproduction run
	route.on(
		["GET"],
		[
			"/reproduction-runs/:reproductionRunId/artifacts",
			"/verification-runs/:reproductionRunId/artifacts",
		],
		async (c) => {
			const authUser = getAuthContextUser(c);
			const runId = c.req.param("reproductionRunId");

			const run = await repo.getRun(runId);
			if (!run) {
				throw new HttpError(404, "Reproduction run not found");
			}

			const project = await projectRepository.findById(run.projectId);
			if (!project || project.ownerUserId !== authUser.userId) {
				throw new HttpError(403, "Forbidden");
			}

			const artifacts = await repo.listArtifacts(runId);
			const evidence = await repo.listEvidence(runId);

			return c.json({ artifacts, evidence });
		},
	);

	// Get specific reproduction artifact file content
	route.get(
		"/reproduction-runs/:reproductionRunId/artifacts/:artifactId",
		async (c) => {
			const authUser = getAuthContextUser(c);
			const runId = c.req.param("reproductionRunId");
			const artifactId = c.req.param("artifactId");

			const run = await repo.getRun(runId);
			if (!run) {
				throw new HttpError(404, "Reproduction run not found");
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

			const storage = new ReproductionArtifactStorage();
			const content = await storage.readReproductionTextArtifact(artifact.path);

			c.header(
				"Content-Disposition",
				`attachment; filename="${path.basename(artifact.path)}"`,
			);
			if (artifact.format === "json") {
				return c.json(JSON.parse(content));
			}
			return c.text(content);
		},
	);

	return route;
}
