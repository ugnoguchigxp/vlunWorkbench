import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { MAX_DYNAMIC_TIMEOUT_SEC } from "../../../shared/schemas/dynamic.schema";
import type { AppDatabase } from "../../db";
import { projects } from "../../db/schema";
import {
	DEFAULT_DYNAMIC_ARTIFACT_DIRECTORY_DEPTH_LIMIT,
	DEFAULT_DYNAMIC_ARTIFACT_ENTRY_LIMIT,
	DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT,
	DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT_BYTES,
	DEFAULT_DYNAMIC_ARTIFACT_TOTAL_LIMIT_BYTES,
	DynamicArtifactStorage,
} from "./dynamic-artifact-storage";
import {
	executeDynamicDockerRun,
	resolveDynamicDockerLimits,
} from "./dynamic-docker-executor";
import { evaluateDynamicOutcome } from "./dynamic-evaluator";
import { validateDynamicProfilePolicy } from "./dynamic-profiles";
import { DynamicRepository } from "./dynamic-repository";
import {
	type ProcessOutputLimits,
	resolveProcessOutputLimits,
} from "../scans/tools/tool-process-runner";

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

type DynamicArtifactCollectionLimits = {
	maxFiles: number;
	maxTotalBytes: number;
	maxFileBytes: number;
	maxDepth: number;
	maxEntries: number;
};

type DynamicRunnerOptions = {
	outputLimits?: Partial<ProcessOutputLimits>;
	artifactLimits?: Partial<DynamicArtifactCollectionLimits>;
	storage?: DynamicArtifactStorage;
};

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
		return { status: "timed_out", failureKind: "dynamic_timeout" };
	}
	if (text.includes("dynamic_output_limit_exceeded")) {
		return {
			status: "failed",
			failureKind: "dynamic_output_limit_exceeded",
		};
	}
	if (
		text.includes("no such image") ||
		text.includes("unable to find image") ||
		text.includes("pull access denied") ||
		text.includes("manifest unknown")
	) {
		return { status: "failed", failureKind: "docker_image_missing" };
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
	return { status: "failed", failureKind: "unknown_error" };
}

function resolveTimeoutSec(
	profileTimeoutSec: number,
	requested?: number,
): number {
	if (
		!Number.isInteger(profileTimeoutSec) ||
		profileTimeoutSec <= 0 ||
		profileTimeoutSec > MAX_DYNAMIC_TIMEOUT_SEC
	) {
		throw new Error(
			`Profile timeout_sec must be a positive integer no greater than ${MAX_DYNAMIC_TIMEOUT_SEC}.`,
		);
	}
	if (requested === undefined) return profileTimeoutSec;
	if (
		!Number.isInteger(requested) ||
		requested <= 0 ||
		requested > MAX_DYNAMIC_TIMEOUT_SEC
	) {
		throw new Error(
			`Requested timeout_sec must be a positive integer no greater than ${MAX_DYNAMIC_TIMEOUT_SEC}.`,
		);
	}
	if (requested > profileTimeoutSec) {
		throw new Error("Requested timeout_sec exceeds the profile timeout_sec.");
	}
	return requested;
}

function resolveNetworkMode(
	profileNetwork: string,
	requested?: "none" | "default",
): "none" | "default" {
	const normalizedProfile =
		profileNetwork === "default" ? "default" : ("none" as const);
	if (!requested) return normalizedProfile;
	if (requested === "default" && normalizedProfile !== "default") {
		throw new Error(
			"Requested network mode exceeds the profile network policy.",
		);
	}
	return requested;
}

async function walkFiles(
	dir: string,
	limits: DynamicArtifactCollectionLimits,
): Promise<string[]> {
	const files: string[] = [];
	let totalBytes = 0;
	let entriesSeen = 0;

	const walk = async (
		currentDirectory: string,
		depth: number,
	): Promise<void> => {
		if (depth > limits.maxDepth) {
			throw new Error(
				`dynamic_artifact_depth_limit_exceeded:${limits.maxDepth}`,
			);
		}
		const directory = await fs.opendir(currentDirectory);
		for await (const entry of directory) {
			entriesSeen += 1;
			if (entriesSeen > limits.maxEntries) {
				throw new Error(
					`dynamic_artifact_entry_limit_exceeded:${limits.maxEntries}`,
				);
			}
			const fullPath = path.join(currentDirectory, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			const fileStat = await fs.stat(fullPath);
			if (fileStat.size > limits.maxFileBytes) {
				throw new Error(
					`dynamic_artifact_file_limit_exceeded:${fileStat.size}:${limits.maxFileBytes}`,
				);
			}
			totalBytes += fileStat.size;
			if (totalBytes > limits.maxTotalBytes) {
				throw new Error(
					`dynamic_artifact_total_limit_exceeded:${totalBytes}:${limits.maxTotalBytes}`,
				);
			}
			files.push(path.relative(dir, fullPath));
			if (files.length > limits.maxFiles) {
				throw new Error(
					`dynamic_artifact_count_limit_exceeded:${limits.maxFiles}`,
				);
			}
		}
	};

	await walk(dir, 0);
	return files;
}

export class DynamicRunner {
	private readonly repo: DynamicRepository;
	private readonly storage: DynamicArtifactStorage;
	private readonly outputLimits: ProcessOutputLimits;
	private readonly artifactLimits: DynamicArtifactCollectionLimits;

	constructor(
		private readonly db: AppDatabase,
		options: DynamicRunnerOptions = {},
	) {
		this.repo = new DynamicRepository(db);
		this.outputLimits = resolveProcessOutputLimits(options.outputLimits);
		this.artifactLimits = {
			maxFiles:
				options.artifactLimits?.maxFiles ?? DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT,
			maxTotalBytes:
				options.artifactLimits?.maxTotalBytes ??
				DEFAULT_DYNAMIC_ARTIFACT_TOTAL_LIMIT_BYTES,
			maxFileBytes:
				options.artifactLimits?.maxFileBytes ??
				DEFAULT_DYNAMIC_ARTIFACT_FILE_LIMIT_BYTES,
			maxDepth:
				options.artifactLimits?.maxDepth ??
				DEFAULT_DYNAMIC_ARTIFACT_DIRECTORY_DEPTH_LIMIT,
			maxEntries:
				options.artifactLimits?.maxEntries ??
				DEFAULT_DYNAMIC_ARTIFACT_ENTRY_LIMIT,
		};
		for (const [label, value] of Object.entries(this.artifactLimits)) {
			if (!Number.isSafeInteger(value) || value <= 0) {
				throw new Error(`${label} must be a positive integer.`);
			}
		}
		this.storage =
			options.storage ??
			new DynamicArtifactStorage(undefined, {
				maxFileBytes: this.artifactLimits.maxFileBytes,
			});
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

		const validation = validateDynamicProfilePolicy(profileConfig);
		if (!validation.valid) {
			throw new Error(
				`Profile command policy validation failed: ${validation.reason}`,
			);
		}

		const timeoutSec = resolveTimeoutSec(
			profileConfig.timeoutSec ?? 120,
			options.timeoutSec,
		);
		const networkMode = resolveNetworkMode(
			profileConfig.network ?? "none",
			options.network,
		);
		const image = options.dockerImage ?? "vuln-workbench-dynamic:local";
		const resourceLimits = resolveDynamicDockerLimits({
			profileMemory: profileConfig.memory,
			profileCpus: profileConfig.cpus,
			requestedMemory: options.memory,
			requestedCpus: options.cpus,
		});

		return {
			dryRun: true,
			profileId: profileConfig.profileId,
			dynamicKind: profileConfig.dynamicKind,
			command: profileConfig.commandJson,
			workingDirectory: profileConfig.workingDirectory,
			timeoutSec,
			network: networkMode,
			memory: resourceLimits.memory,
			cpus: resourceLimits.cpus,
			pidsLimit: resourceLimits.pidsLimit,
			writableWorkdir: profileConfig.writableWorkdir,
			allowProjectScripts: profileConfig.allowProjectScripts,
			expectedArtifacts: profileConfig.expectedArtifactsJson || [],
			runnerOptions: {
				runner: options.runner,
				image,
				networkMode,
				memory: resourceLimits.memory,
				memorySwap: resourceLimits.memory,
				cpus: resourceLimits.cpus,
				pidsLimit: resourceLimits.pidsLimit,
				outputLimits: this.outputLimits,
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

		const validation = validateDynamicProfilePolicy(profileConfig);
		if (!validation.valid) {
			throw new Error(
				`Profile command policy validation failed: ${validation.reason}`,
			);
		}

		const timeoutSec = resolveTimeoutSec(
			profileConfig.timeoutSec ?? 120,
			options.timeoutSec,
		);
		const networkMode = resolveNetworkMode(
			profileConfig.network ?? "none",
			options.network,
		);
		const image = options.dockerImage ?? "vuln-workbench-dynamic:local";
		const resourceLimits = resolveDynamicDockerLimits({
			profileMemory: profileConfig.memory,
			profileCpus: profileConfig.cpus,
			requestedMemory: options.memory,
			requestedCpus: options.cpus,
		});
		// 1. Create dynamic run record
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
					memory: resourceLimits.memory,
					memorySwap: resourceLimits.memory,
					cpus: resourceLimits.cpus,
					pidsLimit: resourceLimits.pidsLimit,
				},
				outputLimits: this.outputLimits,
				artifactLimits: this.artifactLimits,
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
		let hostOutDir: string | null = null;

		try {
			// Setup the output mount only after every request-time policy check passes.
			hostOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "dynamic-run-out-"));
			// 2. Coordinate and execute the container process
			const containerName = `vuln-workbench-dyn-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
			const dockerBin = process.env.VULN_WORKBENCH_DOCKER_BIN ?? "docker";

			const runResult = await executeDynamicDockerRun({
				dockerBin,
				image,
				containerName,
				networkMode,
				memory: resourceLimits.memory,
				cpus: resourceLimits.cpus,
				pidsLimit: resourceLimits.pidsLimit,
				outputLimits: this.outputLimits,
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
				execution: runResult.executionMetadata,
			};

			// 3. Save stdout & stderr log artifacts
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

			// 4. Handle Docker infrastructure failures (daemon missing, missing image)
			const hasDockerError =
				(!runResult.ok && !runResult.timedOut) ||
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

			// 5. Collect generated artifacts from the host output mount directory
			const generatedFiles = await walkFiles(hostOutDir, this.artifactLimits);
			const collectedArtifacts: Array<
				Awaited<ReturnType<DynamicRepository["createArtifact"]>>
			> = [];
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

			// 6. Evaluate dynamic run outcome
			const evalResult = evaluateDynamicOutcome({
				dynamicKind: profileConfig.dynamicKind as "test" | "sanitizer" | "fuzz",
				exitCode: runResult.exitCode,
				stdout: runResult.stdout,
				stderr: runResult.stderr,
				isTimeout: runResult.timedOut,
				hasExpectedArtifacts: collectedArtifacts.length > 0,
			});

			// 7. Update DB run status and outcome
			const updatedMetadata = {
				...runMetadata,
				evaluator: {
					outcome: evalResult.outcome,
					reason: evalResult.reason,
					matchedSignatures: evalResult.metadata.matchedSignatures,
				},
			};

			const finalStatus =
				evalResult.outcome === "error"
					? "failed"
					: evalResult.outcome === "timed_out"
						? "timed_out"
						: "completed";

			await this.repo.updateRunStatus(runId, finalStatus, {
				outcome: evalResult.outcome,
				exitCode: runResult.exitCode,
				metadata: updatedMetadata,
			});

			// 8. Create appropriate evidence logs
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
			const message = err instanceof Error ? err.message : String(err);
			const failureKind = message.startsWith("dynamic_artifact_")
				? "dynamic_artifact_limit_exceeded"
				: "unknown_error";
			await this.repo.updateRunStatus(runId, "failed", {
				outcome: "error",
				errorMessage: message,
				metadata: {
					...getBaseMetadata(runRecord.metadata),
					failureKind,
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
				message,
			};
		} finally {
			// 9. Cleanup temp files on host
			if (hostOutDir) {
				await fs
					.rm(hostOutDir, { recursive: true, force: true })
					.catch(() => {});
			}
		}
	}
}
