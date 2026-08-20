import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { createDbConnection } from "../api/db";
import { projects, scanArtifacts, scanRuns, users } from "../api/db/schema";
import { ArtifactStorage } from "../api/modules/scans/artifact-storage";
import { runRuntimeScannerIntoExistingScan } from "../api/modules/scans/profile-runtime-step-runner";
import { ScanRepository } from "../api/modules/scans/repositories";
import { startTodolistRuntimeTarget } from "./todolist-runtime-target";
import {
	resolveTodolistAcceptanceTarget,
	selectTodolistAcceptanceProfiles,
} from "./todolist-scan-acceptance-lib";

const TOOLBOX_IMAGE = "vuln-workbench-toolbox:local";

function parsePayload(stdout: string): Record<string, unknown> {
	const candidate = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (!candidate) throw new Error("todolist_acceptance_missing_cli_payload");
	const parsed = JSON.parse(candidate);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("todolist_acceptance_invalid_cli_payload");
	}
	return parsed as Record<string, unknown>;
}

async function run(command: string[], env: Record<string, string>) {
	const child = Bun.spawn(command, {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function requireToolboxImage(image: string): Promise<void> {
	const probe = await run(["docker", "image", "inspect", image], {});
	if (probe.exitCode !== 0) {
		throw new Error(
			"todolist_acceptance_toolbox_missing: run bun run docker:toolbox:build after resolving scanner-data locks",
		);
	}
}

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			"repo-path": { type: "string" },
			"toolbox-image": { type: "string" },
			only: { type: "string" },
			keep: { type: "boolean", default: false },
		},
		strict: true,
	}).values;
	const toolboxImage = args["toolbox-image"] ?? TOOLBOX_IMAGE;
	const selected = selectTodolistAcceptanceProfiles(
		args.only?.split(",").filter(Boolean) ?? [],
	);
	const target = await resolveTodolistAcceptanceTarget(args["repo-path"]);
	await requireToolboxImage(toolboxImage);

	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "vwb-todolist-acceptance-"),
	);
	const dbPath = path.join(root, "acceptance.sqlite");
	const artifactRoot = path.join(root, "artifacts");
	const env = {
		DATABASE_URL: `file:${dbPath}`,
		SCAN_ARTIFACT_ROOT: artifactRoot,
		SCAN_EXECUTION_MODE: "docker",
		SCAN_DOCKER_IMAGE: toolboxImage,
	};
	try {
		const migration = await run(["bun", "run", "api/cli/migrate.ts"], env);
		if (migration.exitCode !== 0) {
			throw new Error(
				`todolist_acceptance_migration_failed:${migration.stderr}`,
			);
		}
		const connection = createDbConnection(env.DATABASE_URL, {
			// Each acceptance invocation owns its temporary database and writer.
			shutdownWriterOnClose: true,
		});
		try {
			await connection.db.insert(users).values({
				id: "00000000-0000-4000-8000-000000000001",
				email: "todolist-acceptance@example.invalid",
				passwordHash: "acceptance-only",
				displayName: "todolist acceptance",
				role: "admin",
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			const [project] = await connection.db
				.insert(projects)
				.values({
					ownerUserId: "00000000-0000-4000-8000-000000000001",
					name: "todolist scanner acceptance",
					repoPath: target.repoPath,
					canonicalRepoPath: target.repoPath,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.returning();
			if (!project)
				throw new Error("todolist_acceptance_project_create_failed");

			const imageProfile = selected.some((profile) => profile.requiresTarget);
			const targetImage = `vuln-workbench-todolist-acceptance:${target.commit.slice(0, 12)}`;
			if (imageProfile) {
				const imageBuild = await run(
					["docker", "build", "-t", targetImage, target.repoPath],
					env,
				);
				if (imageBuild.exitCode !== 0) {
					throw new Error(
						`todolist_acceptance_target_image_build_failed:${imageBuild.stderr}`,
					);
				}
				const imageArchive = path.join(root, "todolist-image.tar");
				const imageSave = await run(
					["docker", "save", "--output", imageArchive, targetImage],
					env,
				);
				if (imageSave.exitCode !== 0) {
					throw new Error(
						`todolist_acceptance_target_image_save_failed:${imageSave.stderr}`,
					);
				}
			}

			const storage = new ArtifactStorage(artifactRoot);
			const scanRepo = new ScanRepository(connection.db);
			const results: Array<Record<string, unknown>> = [];
			for (const profile of selected) {
				let scanRunId: string;
				if (profile.id === "nuclei-safe" || profile.id === "zap-baseline") {
					const scanRun = await scanRepo.createScanRun({
						projectId: project.id,
						profile: profile.profile,
						status: "running",
						metadata: {
							acceptanceTarget: { kind: "todolist_container" },
						},
					});
					scanRunId = scanRun.id;
					const runtimeTarget = await startTodolistRuntimeTarget(targetImage);
					try {
						const runtime = await runRuntimeScannerIntoExistingScan({
							db: connection.db,
							projectId: project.id,
							scanRunId,
							adapter: profile.id,
							targetOrigin: runtimeTarget.origin,
							artifactStorage: storage,
							timeoutSec: 600,
							execution: {
								runner: "docker",
								docker: { image: toolboxImage, networkMode: "default" },
							},
						});
						if (runtime.error) {
							await scanRepo.updateScanRunStatus(scanRunId, "failed", {
								profileOutcome: "failed",
								metadata: { acceptanceRuntimeError: runtime.error },
							});
							throw new Error(
								`todolist_acceptance_scan_failed:${profile.id}:${runtime.error}`,
							);
						}
						await scanRepo.updateScanRunStatus(scanRunId, "completed", {
							profileOutcome: "completed",
							metadata: {
								acceptanceTarget: {
									kind: "todolist_container",
									containerName: runtimeTarget.containerName,
								},
								acceptanceRuntime: {
									adapter: profile.id,
									findingCount: runtime.findingCount,
									artifactIds: runtime.artifactIds,
								},
							},
						});
					} finally {
						await runtimeTarget.stop();
					}
				} else {
					const command = [
						"bun",
						"run",
						"api/cli/scan-profile.ts",
						"--",
						"--project-id",
						project.id,
						"--project-path",
						target.repoPath,
						"--profile",
						profile.profile,
						"--runner",
						"docker",
						"--docker-image",
						toolboxImage,
						"--timeout-sec",
						"600",
						"--final-report",
						"false",
						"--automated-diagnostic",
						"false",
						...(profile.step ? ["--step", profile.step] : []),
						...(profile.id === "trivy-image"
							? ["--image-tar", path.join(root, "todolist-image.tar")]
							: []),
					];
					const execution = await run(command, env);
					const payload = parsePayload(execution.stdout);
					scanRunId = payload.scanRunId as string;
					if (typeof scanRunId !== "string") {
						throw new Error(
							`todolist_acceptance_scan_id_missing:${profile.id}`,
						);
					}
					if (execution.exitCode !== 0 || payload.ok !== true) {
						throw new Error(
							`todolist_acceptance_scan_failed:${profile.id}:${payload.message ?? execution.stderr}`,
						);
					}
				}
				const [scanRun] = await connection.db
					.select()
					.from(scanRuns)
					.where(eq(scanRuns.id, scanRunId));
				const artifacts = await connection.db
					.select()
					.from(scanArtifacts)
					.where(eq(scanArtifacts.scanRunId, scanRunId));
				const kinds = new Set(artifacts.map((artifact) => artifact.kind));
				for (const expectedKind of profile.expectedArtifactKinds) {
					if (!kinds.has(expectedKind)) {
						throw new Error(
							`todolist_acceptance_artifact_missing:${profile.id}:${expectedKind}:observed=${[...kinds].join(",") || "none"}`,
						);
					}
				}
				for (const artifact of artifacts) {
					if (!artifact.storageKey) {
						throw new Error(
							`todolist_acceptance_storage_key_missing:${artifact.id}`,
						);
					}
					const intact = await storage.verifyArtifact(
						artifact.storageKey ?? artifact.path,
						{ sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
						{ maxBytes: 64 * 1024 * 1024 },
					);
					if (!intact) {
						throw new Error(
							`todolist_acceptance_artifact_integrity_failed:${artifact.id}`,
						);
					}
				}
				if (
					"expectedNotApplicableReason" in profile &&
					profile.expectedNotApplicableReason
				) {
					const stepResults = (
						scanRun?.metadata as Record<string, unknown> | null
					)?.stepResults;
					const hasExpectedReason =
						Array.isArray(stepResults) &&
						stepResults.some(
							(step) =>
								Boolean(step) &&
								typeof step === "object" &&
								(step as Record<string, unknown>).reasonCode ===
									profile.expectedNotApplicableReason,
						);
					if (!hasExpectedReason) {
						throw new Error(
							`todolist_acceptance_na_result_missing:${profile.id}`,
						);
					}
				}
				results.push({
					profile: profile.id,
					scanRunId,
					profileOutcome: scanRun?.profileOutcome ?? null,
					artifactCount: artifacts.length,
				});
			}
			console.log(JSON.stringify({ ok: true, target, results, artifactRoot }));
		} finally {
			connection.sqlite.close();
		}
	} finally {
		if (!args.keep) await fs.rm(root, { recursive: true, force: true });
	}
}

await main();
