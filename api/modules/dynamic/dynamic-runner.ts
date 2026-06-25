import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { findings, projects } from "../../db/schema";
import { DynamicArtifactStorage } from "./dynamic-artifact-storage";
import { evaluateDynamicOutcome } from "./dynamic-evaluator";
import { validateDynamicCommand } from "./dynamic-profiles";
import { DynamicRepository } from "./dynamic-repository";

export interface RunDynamicOptions {
	projectId: string;
	profileId: string;
	scanRunId?: string | null;
	findingId?: string | null;
	runner: "docker";
	dockerImage?: string;
	network?: "none" | "default";
	timeoutSec?: number;
	memory?: string;
	cpus?: string;
	toolCacheDir?: string;
	createdByUserId?: string | null;
}

function getBaseMetadata(recordMetadata: unknown): Record<string, unknown> {
	return recordMetadata && typeof recordMetadata === "object"
		? (recordMetadata as Record<string, unknown>)
		: {};
}

function classifyExecutionFailure(input: {
	error?: string;
	stderr?: string;
	exitCode?: number | null;
}): {
	status: "failed" | "timed_out";
	failureKind: string;
} {
	const text = `${input.error ?? ""}\n${input.stderr ?? ""}`.toLowerCase();
	if (text.includes("timed out") || text.includes("timeout")) {
		return { status: "timed_out", failureKind: "timeout" };
	}
	if (
		text.includes("no such image") ||
		text.includes("unable to find image") ||
		text.includes("pull access denied") ||
		text.includes("manifest unknown")
	) {
		return { status: "failed", failureKind: "image_missing" };
	}
	if (
		input.exitCode === 125 ||
		input.exitCode === 127 ||
		text.includes("docker process error") ||
		text.includes("enoent") ||
		text.includes("cannot connect to the docker daemon") ||
		text.includes("is the docker daemon running")
	) {
		return { status: "failed", failureKind: "docker_unavailable" };
	}
	return { status: "failed", failureKind: "execution_failed" };
}

async function walkFiles(dir: string, base: string = dir): Promise<string[]> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		const files: string[] = [];
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...(await walkFiles(fullPath, base)));
			} else if (entry.isFile()) {
				files.push(path.relative(base, fullPath));
			}
		}
		return files;
	} catch {
		return [];
	}
}

export class DynamicRunner {
	private readonly repo: DynamicRepository;
	private readonly storage: DynamicArtifactStorage;

	constructor(private readonly db: AppDatabase) {
		this.repo = new DynamicRepository(db);
		this.storage = new DynamicArtifactStorage();
	}

	async dryRun(options: RunDynamicOptions) {
		const project = await this.db.query.projects.findFirst({
			where: eq(projects.id, options.projectId),
		});
		if (!project) {
			throw new Error(`Project not found: ${options.projectId}`);
		}

		const profileConfig = await this.repo.getConfigByProfileId(
			options.projectId,
			options.profileId,
		);
		if (!profileConfig) {
			throw new Error(`Profile config not found: ${options.profileId}`);
		}

		if (!profileConfig.enabled) {
			throw new Error(`Profile config is disabled: ${options.profileId}`);
		}

		const validation = validateDynamicCommand(
			profileConfig.commandJson,
			profileConfig.allowProjectScripts,
		);
		if (!validation.valid) {
			throw new Error(
				`Profile command policy validation failed: ${validation.reason}`,
			);
		}

		const timeoutSec = options.timeoutSec ?? profileConfig.timeoutSec ?? 120;
		const networkMode =
			options.network ??
			(profileConfig.network as "none" | "default") ??
			"none";
		const image = options.dockerImage ?? "vuln-workbench-dynamic:local";

		return {
			dryRun: true,
			profileId: profileConfig.profileId,
			dynamicKind: profileConfig.dynamicKind,
			command: profileConfig.commandJson,
			workingDirectory: profileConfig.workingDirectory,
			timeoutSec,
			network: networkMode,
			memory: options.memory ?? profileConfig.memory ?? null,
			cpus: options.cpus ?? profileConfig.cpus ?? null,
			writableWorkdir: profileConfig.writableWorkdir,
			allowProjectScripts: profileConfig.allowProjectScripts,
			expectedArtifacts: profileConfig.expectedArtifactsJson || [],
			runnerOptions: {
				runner: options.runner,
				image,
				networkMode,
				memory: options.memory ?? profileConfig.memory ?? null,
				cpus: options.cpus ?? profileConfig.cpus ?? null,
				timeoutSec,
			},
		};
	}

	async run(options: RunDynamicOptions) {
		const project = await this.db.query.projects.findFirst({
			where: eq(projects.id, options.projectId),
		});
		if (!project) {
			throw new Error(`Project not found: ${options.projectId}`);
		}

		const profileConfig = await this.repo.getConfigByProfileId(
			options.projectId,
			options.profileId,
		);
		if (!profileConfig) {
			throw new Error(`Profile config not found: ${options.profileId}`);
		}

		if (!profileConfig.enabled) {
			throw new Error(`Profile config is disabled: ${options.profileId}`);
		}

		const validation = validateDynamicCommand(
			profileConfig.commandJson,
			profileConfig.allowProjectScripts,
		);
		if (!validation.valid) {
			throw new Error(
				`Profile command policy validation failed: ${validation.reason}`,
			);
		}

		// 1. Setup temp directory for output mount on host
		const hostOutDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "dynamic-run-out-"),
		);

		const timeoutSec = options.timeoutSec ?? profileConfig.timeoutSec ?? 120;
		const networkMode =
			options.network ??
			(profileConfig.network as "none" | "default") ??
			"none";
		const image = options.dockerImage ?? "vuln-workbench-dynamic:local";

		// 2. Create dynamic run record
		const runRecord = await this.repo.createRun({
			projectId: project.id,
			scanRunId: options.scanRunId ?? null,
			findingId: options.findingId ?? null,
			profileConfigId: profileConfig.id,
			profileId: profileConfig.profileId,
			dynamicKind: profileConfig.dynamicKind as "test" | "sanitizer" | "fuzz",
			status: "running",
			runner: options.runner,
			commandJson: profileConfig.commandJson,
			createdByUserId: options.createdByUserId,
			metadata: {
				profileVersion: 1,
				timeoutSec,
				networkMode,
				resourceLimits: {
					memory: options.memory ?? profileConfig.memory ?? null,
					cpus: options.cpus ?? profileConfig.cpus ?? null,
				},
				runnerMetadata: {
					runner: options.runner,
					docker: {
						image,
						networkMode,
						mountMode: {
							repo: "read-only",
							output: "read-write",
						},
					},
				},
			},
		});

		const runId = runRecord.id;

		try {
			// 3. Coordinate and Execute the container process
			const containerName = `vuln-workbench-dyn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
			const dockerBin = process.env.VULN_WORKBENCH_DOCKER_BIN ?? "docker";

			const runResult = await this.executeDockerRun({
				dockerBin,
				image,
				containerName,
				networkMode,
				memory: options.memory ?? profileConfig.memory ?? null,
				cpus: options.cpus ?? profileConfig.cpus ?? null,
				repoPath: project.repoPath,
				hostOutDir,
				workingDirectory: profileConfig.workingDirectory,
				command: profileConfig.commandJson,
				writableWorkdir: profileConfig.writableWorkdir,
				expectedArtifacts: profileConfig.expectedArtifactsJson || [],
				timeoutSec,
			});

			const runMetadata = {
				...getBaseMetadata(runRecord.metadata),
				elapsedMs: runResult.elapsedMs,
			};

			// 4. Save stdout & stderr log artifacts
			const stdoutArtifact = await this.storage.saveDynamicLog(
				runId,
				"stdout",
				runResult.stdout,
			);
			const dbStdout = await this.repo.createArtifact({
				dynamicRunId: runId,
				projectId: project.id,
				findingId: options.findingId ?? null,
				kind: "stdout",
				format: "text",
				path: stdoutArtifact.path,
				sha256: stdoutArtifact.sha256,
				sizeBytes: stdoutArtifact.sizeBytes,
			});

			const stderrArtifact = await this.storage.saveDynamicLog(
				runId,
				"stderr",
				runResult.stderr,
			);
			const dbStderr = await this.repo.createArtifact({
				dynamicRunId: runId,
				projectId: project.id,
				findingId: options.findingId ?? null,
				kind: "stderr",
				format: "text",
				path: stderrArtifact.path,
				sha256: stderrArtifact.sha256,
				sizeBytes: stderrArtifact.sizeBytes,
			});

			// 5. Handle Docker execution failures (daemon missing, crash, missing image, timeout)
			const hasDockerError =
				!runResult.ok ||
				runResult.exitCode === 125 ||
				runResult.exitCode === 127 ||
				(runResult.stderr &&
					(runResult.stderr
						.toLowerCase()
						.includes("cannot connect to the docker daemon") ||
						runResult.stderr
							.toLowerCase()
							.includes("is the docker daemon running") ||
						runResult.stderr.toLowerCase().includes("no such image") ||
						runResult.stderr.toLowerCase().includes("unable to find image") ||
						runResult.stderr.toLowerCase().includes("docker process error")));

			if (hasDockerError) {
				const { status: finalStatus, failureKind } = classifyExecutionFailure({
					error: runResult.error,
					stderr: runResult.stderr,
					exitCode: runResult.exitCode,
				});

				await this.repo.updateRunStatus(runId, finalStatus, {
					outcome: "error",
					exitCode: runResult.exitCode,
					errorMessage: runResult.error || "Sandbox execution failed",
					metadata: {
						...runMetadata,
						failureKind,
					},
				});

				const evidence = await this.repo.createEvidence({
					dynamicRunId: runId,
					projectId: project.id,
					findingId: options.findingId ?? null,
					kind: "dynamic-result",
					title: `Sandbox execution failed: ${runResult.error || "Unknown error"}`,
					artifactId: dbStderr.id,
					snippet: runResult.stderr || runResult.error || "No stderr output.",
				});

				return {
					ok: false,
					dynamicRunId: runId,
					projectId: project.id,
					findingId: options.findingId ?? null,
					profileId: profileConfig.profileId,
					dynamicKind: profileConfig.dynamicKind,
					status: finalStatus,
					outcome: "error",
					runner: options.runner,
					exitCode: runResult.exitCode,
					artifactIds: [dbStdout.id, dbStderr.id],
					evidenceIds: [evidence.id],
					message: runResult.error || "Sandbox execution failed",
				};
			}

			// 6. Collect generated artifacts from the host output mount directory
			const generatedFiles = await walkFiles(hostOutDir);
			const collectedArtifacts: any[] = [];
			for (const relPath of generatedFiles) {
				const hostFilePath = path.join(hostOutDir, relPath);
				const artifactSave = await this.storage.saveDynamicRawArtifact(
					runId,
					hostFilePath,
					relPath,
				);

				const kind =
					profileConfig.dynamicKind === "fuzz" ? "crash" : "raw_result";

				const dbArtifact = await this.repo.createArtifact({
					dynamicRunId: runId,
					projectId: project.id,
					findingId: options.findingId ?? null,
					kind,
					format: path.extname(relPath).replace(/^\./, "") || "unknown",
					path: artifactSave.path,
					sha256: artifactSave.sha256,
					sizeBytes: artifactSave.sizeBytes,
				});
				collectedArtifacts.push(dbArtifact);
			}

			// 7. Evaluate dynamic run outcome
			const evalResult = evaluateDynamicOutcome({
				dynamicKind: profileConfig.dynamicKind as "test" | "sanitizer" | "fuzz",
				exitCode: runResult.exitCode,
				stdout: runResult.stdout,
				stderr: runResult.stderr,
				isTimeout: false,
				hasExpectedArtifacts: collectedArtifacts.length > 0,
			});

			// 8. Update DB run status and outcome
			const updatedMetadata = {
				...runMetadata,
				evaluator: {
					outcome: evalResult.outcome,
					reason: evalResult.reason,
					matchedSignatures: evalResult.metadata.matchedSignatures,
				},
			};

			const finalStatus =
				evalResult.outcome === "error" ? "failed" : "completed";

			await this.repo.updateRunStatus(runId, finalStatus, {
				outcome: evalResult.outcome,
				exitCode: runResult.exitCode,
				metadata: updatedMetadata,
			});

			// 9. Create appropriate evidence logs
			let evidenceTitle = "";
			let evidenceKind = "dynamic-result";
			let snippetText = evalResult.reason;
			let mainArtifactId: string | null = null;

			if (profileConfig.dynamicKind === "test") {
				evidenceKind = "dynamic-test-log";
				evidenceTitle = `Dynamic Test check: ${evalResult.outcome.toUpperCase()}`;
				snippetText = `Exit code ${runResult.exitCode}. Reason: ${evalResult.reason}`;
				mainArtifactId =
					evalResult.outcome === "passed" ? dbStdout.id : dbStderr.id;
			} else if (profileConfig.dynamicKind === "sanitizer") {
				evidenceKind =
					evalResult.outcome === "crashed"
						? "sanitizer-finding"
						: "dynamic-result";
				evidenceTitle = `Dynamic Sanitizer check: ${evalResult.outcome.toUpperCase()}`;
				snippetText = evalResult.reason;
				mainArtifactId =
					evalResult.outcome === "crashed" ? dbStderr.id : dbStdout.id;
			} else if (profileConfig.dynamicKind === "fuzz") {
				evidenceKind =
					evalResult.outcome === "crashed" ? "fuzz-crash" : "dynamic-result";
				evidenceTitle = `Dynamic Fuzz check: ${evalResult.outcome.toUpperCase()}`;
				snippetText = evalResult.reason;
				mainArtifactId =
					collectedArtifacts.length > 0
						? collectedArtifacts[0].id
						: dbStdout.id;
			}

			const evidence = await this.repo.createEvidence({
				dynamicRunId: runId,
				projectId: project.id,
				findingId: options.findingId ?? null,
				kind: evidenceKind,
				title: evidenceTitle,
				artifactId: mainArtifactId,
				snippet: snippetText.slice(0, 1000),
				metadata: evalResult.metadata,
			});

			return {
				ok: finalStatus === "completed",
				dynamicRunId: runId,
				projectId: project.id,
				findingId: options.findingId ?? null,
				profileId: profileConfig.profileId,
				dynamicKind: profileConfig.dynamicKind,
				status: finalStatus,
				outcome: evalResult.outcome,
				runner: options.runner,
				exitCode: runResult.exitCode,
				artifactIds: [
					dbStdout.id,
					dbStderr.id,
					...collectedArtifacts.map((a) => a.id),
				],
				evidenceIds: [evidence.id],
			};
		} catch (err) {
			// Update DB record on unexpected execution failure
			await this.repo.updateRunStatus(runId, "failed", {
				outcome: "error",
				errorMessage: (err as Error).message,
				metadata: {
					...getBaseMetadata(runRecord.metadata),
					failureKind: "unexpected_failure",
				},
			});
			return {
				ok: false,
				dynamicRunId: runId,
				projectId: project.id,
				findingId: options.findingId ?? null,
				profileId: profileConfig.profileId,
				dynamicKind: profileConfig.dynamicKind,
				status: "failed",
				outcome: "error",
				runner: options.runner,
				message: (err as Error).message,
			};
		} finally {
			// 10. Cleanup temp files on host
			await fs.rm(hostOutDir, { recursive: true, force: true }).catch(() => {});
		}
	}

	private async executeDockerRun(params: {
		dockerBin: string;
		image: string;
		containerName: string;
		networkMode: "none" | "default";
		memory?: string | null;
		cpus?: string | null;
		repoPath: string;
		hostOutDir: string;
		workingDirectory: string;
		command: string[];
		writableWorkdir: boolean;
		expectedArtifacts: string[];
		timeoutSec: number;
	}): Promise<{
		ok: boolean;
		exitCode: number | null;
		stdout: string;
		stderr: string;
		elapsedMs: number;
		error?: string;
	}> {
		const cleanGlobs = params.expectedArtifacts.map((glob) =>
			glob.replace(/\*\*\/\*/g, "*").replace(/\*\*/g, "*"),
		);

		let copyCommands = "";
		if (cleanGlobs.length > 0) {
			copyCommands = "\n# Copy expected artifacts\n";
			for (const glob of cleanGlobs) {
				const lastSlash = glob.lastIndexOf("/");
				const parentDir = lastSlash !== -1 ? glob.slice(0, lastSlash) : ".";
				copyCommands += `mkdir -p "/workspace/out/${parentDir}"\n`;
				copyCommands += `cp -R ${glob} "/workspace/out/${parentDir}/" 2>/dev/null || true\n`;
			}
		}

		// Construct shell script containing copying and execution
		const shellScript = `set +e
if [ -d "/workspace/workdir" ]; then
  cp -a /workspace/repo/. /workspace/workdir/
  cd "/workspace/workdir/${params.workingDirectory}"
else
  cd "/workspace/repo/${params.workingDirectory}"
fi

# Execute command
"$@"
EXIT_CODE=$?
${copyCommands}
exit $EXIT_CODE
`;

		// Docker CLI arguments
		const dockerArgs = [
			params.dockerBin,
			"run",
			"--rm",
			"--name",
			params.containerName,
			"--network",
			params.networkMode,
			"--user",
			"65532:65532",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--read-only",
			"--tmpfs",
			"/tmp:rw,nosuid,nodev,size=256m",
			"--env",
			"HOME=/tmp",
			"--env",
			"PATH=/usr/local/bin:/usr/bin:/bin",
		];

		if (params.memory) {
			dockerArgs.push("--memory", params.memory);
		}
		if (params.cpus) {
			dockerArgs.push("--cpus", params.cpus);
		}

		dockerArgs.push(
			"-v",
			`${path.resolve(params.repoPath)}:/workspace/repo:ro`,
		);
		dockerArgs.push(
			"-v",
			`${path.resolve(params.hostOutDir)}:/workspace/out:rw`,
		);

		if (params.writableWorkdir) {
			dockerArgs.push(
				"--tmpfs",
				"/workspace/workdir:rw,nosuid,nodev,size=512m,uid=65532,gid=65532",
			);
		}

		dockerArgs.push("--entrypoint", "/bin/sh");
		dockerArgs.push(params.image, "-c", shellScript, "--", ...params.command);

		const startTime = Date.now();
		let stdout = "";
		let stderr = "";
		let exitCode: number | null = null;
		let proc: any;
		let timeoutId: any;
		let isKilled = false;

		try {
			proc = Bun.spawn(dockerArgs, {
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
				},
			});

			timeoutId = setTimeout(() => {
				isKilled = true;
				proc.kill();
			}, params.timeoutSec * 1000);

			const [stdoutBuf, stderrBuf, code] = await Promise.all([
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).arrayBuffer(),
				proc.exited,
			]);

			exitCode = code;
			stdout = new TextDecoder().decode(stdoutBuf);
			stderr = new TextDecoder().decode(stderrBuf);
		} catch (err: any) {
			return {
				ok: false,
				exitCode: null,
				stdout,
				stderr: stderr || err.message,
				elapsedMs: Date.now() - startTime,
				error: isKilled
					? "Docker execution timed out"
					: `Docker process error: ${err.message}`,
			};
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			if (isKilled) {
				try {
					Bun.spawnSync([params.dockerBin, "rm", "-f", params.containerName]);
				} catch {}
			}
		}

		const elapsedMs = Date.now() - startTime;

		if (isKilled) {
			return {
				ok: false,
				exitCode: null,
				stdout,
				stderr,
				elapsedMs,
				error: "Docker execution timed out",
			};
		}

		return {
			ok: true,
			exitCode,
			stdout,
			stderr,
			elapsedMs,
		};
	}
}
