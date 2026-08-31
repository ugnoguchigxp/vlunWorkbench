import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { findings, projects } from "../../db/schema";
import { ScanRepository } from "../scans/repositories";
import { cleanupTemporaryPaths } from "../scans/execution/lifecycle/temporary-path-cleanup";
import { runToolProcess } from "../scans/tools/tool-process-runner";
import { finalizeTemporaryWorkspace } from "../scans/execution/lifecycle/temporary-workspace-cleanup";
import {
	getReproductionProfileById,
	REPRODUCTION_PROFILES,
	type ReproductionProfile,
} from "./profiles";
import { ReproductionArtifactStorage } from "./reproduction-artifact-storage";
import { ReproductionRepository } from "./reproduction-repository";
import {
	classifyReproductionExecutionFailure,
	getReproductionBaseMetadata,
	withReproductionRunnerMetadata,
} from "./reproduction-run-outcome";

export interface RunReproductionOptions {
	findingId: string;
	profileId: string;
	scanRunId?: string | null;
	runner: "docker";
	dockerImage?: string;
	network?: "none" | "default";
	timeoutSec?: number;
	memory?: string;
	cpus?: string;
	toolCacheDir?: string;
	createdByUserId?: string | null;
}

export class ReproductionRunner {
	private readonly repo: ReproductionRepository;
	private readonly storage: ReproductionArtifactStorage;

	constructor(
		private readonly db: AppDatabase,
		private readonly profiles: readonly ReproductionProfile[] = REPRODUCTION_PROFILES,
	) {
		this.repo = new ReproductionRepository(db);
		this.storage = new ReproductionArtifactStorage();
	}

	async dryRun(options: RunReproductionOptions) {
		const finding = await this.db.query.findings.findFirst({
			where: eq(findings.id, options.findingId),
		});
		if (!finding) {
			throw new Error(`Finding not found: ${options.findingId}`);
		}

		const project = await this.db.query.projects.findFirst({
			where: eq(projects.id, finding.projectId),
		});
		if (!project) {
			throw new Error(`Project not found: ${finding.projectId}`);
		}
		if (options.scanRunId) {
			const scan = await new ScanRepository(this.db).findById(
				options.scanRunId,
			);
			if (
				!scan ||
				scan.projectId !== project.id ||
				scan.profile !== "remediation-verification"
			) {
				throw new Error(
					"Reproduction parent scan is not a remediation verification run.",
				);
			}
		}

		const profile = getReproductionProfileById(
			options.profileId,
			this.profiles,
		);
		if (!profile) {
			throw new Error(`Profile not found: ${options.profileId}`);
		}

		const appCheck = profile.isApplicable({ finding });
		if (!appCheck.applicable) {
			throw new Error(
				`Profile ${options.profileId} is not applicable: ${appCheck.reason}`,
			);
		}

		const tempDir = path.join(os.tmpdir(), `repro-dry-${Date.now()}`);
		const tempJsonPath = path.join(
			tempDir,
			profile.buildCommand({
				repoPath: project.repoPath,
				outputPath: "OUT",
				finding,
			}).rawOutputFileName,
		);
		const cmd = profile.buildCommand({
			repoPath: project.repoPath,
			outputPath: tempJsonPath,
			finding,
		});

		return {
			dryRun: true,
			profileId: profile.id,
			isApplicable: true,
			applicabilityReason: appCheck.reason || "Profile is applicable.",
			command: {
				binaryName: cmd.binaryName,
				args: cmd.args,
				rawOutputFileName: cmd.rawOutputFileName,
				outputFormat: cmd.outputFormat,
			},
			runnerOptions: {
				runner: options.runner,
				image: options.dockerImage ?? "vuln-workbench-toolbox:local",
				networkMode: options.network ?? profile.defaultNetworkMode ?? "none",
				memory: options.memory || null,
				cpus: options.cpus || null,
				timeoutSec: options.timeoutSec ?? profile.defaultTimeoutSec,
			},
		};
	}

	async run(options: RunReproductionOptions) {
		const finding = await this.db.query.findings.findFirst({
			where: eq(findings.id, options.findingId),
		});
		if (!finding) {
			throw new Error(`Finding not found: ${options.findingId}`);
		}

		const project = await this.db.query.projects.findFirst({
			where: eq(projects.id, finding.projectId),
		});
		if (!project) {
			throw new Error(`Project not found: ${finding.projectId}`);
		}
		if (options.scanRunId) {
			const scan = await new ScanRepository(this.db).findById(
				options.scanRunId,
			);
			if (
				!scan ||
				scan.projectId !== project.id ||
				scan.profile !== "remediation-verification"
			) {
				throw new Error(
					"Reproduction parent scan is not a remediation verification run.",
				);
			}
		}

		const profile = getReproductionProfileById(
			options.profileId,
			this.profiles,
		);
		if (!profile) {
			throw new Error(`Profile not found: ${options.profileId}`);
		}

		const appCheck = profile.isApplicable({ finding });
		if (!appCheck.applicable) {
			throw new Error(
				`Profile ${options.profileId} is not applicable: ${appCheck.reason}`,
			);
		}

		// 1. Setup temp directory for output
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repro-run-"));
		const tempJsonPath = path.join(tempDir, `repro-output-${Date.now()}.json`);

		let cmd: ReturnType<ReproductionProfile["buildCommand"]>;
		try {
			cmd = profile.buildCommand({
				repoPath: project.repoPath,
				outputPath: tempJsonPath,
				finding,
			});
		} catch (error) {
			await cleanupTemporaryPaths(
				[tempDir],
				"reproduction_workspace_cleanup_failed",
			);
			throw error;
		}

		// 2. Create reproduction run record
		let runRecord: Awaited<ReturnType<ReproductionRepository["createRun"]>>;
		try {
			runRecord = await this.repo.createRun({
				projectId: project.id,
				scanRunId: options.scanRunId ?? finding.scanRunId,
				findingId: finding.id,
				profileId: profile.id,
				status: "running",
				runner: options.runner,
				commandJson: [cmd.binaryName, ...cmd.args],
				createdByUserId: options.createdByUserId,
				metadata: {
					profileVersion: 1,
					timeoutSec: options.timeoutSec ?? profile.defaultTimeoutSec,
					networkMode: options.network ?? profile.defaultNetworkMode ?? "none",
					resourceLimits: {
						memory: options.memory || null,
						cpus: options.cpus || null,
					},
					runnerMetadata: {
						runner: options.runner,
						docker: {
							image: options.dockerImage ?? "vuln-workbench-toolbox:local",
							networkMode:
								options.network ?? profile.defaultNetworkMode ?? "none",
							mountMode: {
								repo: "read-only",
								output: "read-write",
							},
						},
					},
				},
			});
		} catch (error) {
			await cleanupTemporaryPaths(
				[tempDir],
				"reproduction_workspace_cleanup_failed",
			);
			throw error;
		}

		const runId = runRecord.id;

		try {
			// 3. Execute
			await profile.prepareExecution?.();
			const timeoutSec = options.timeoutSec ?? profile.defaultTimeoutSec;
			const runResult = await runToolProcess(cmd.binaryName, cmd.args, {
				timeoutSec,
				execution: {
					runner: "docker",
					docker: {
						image: options.dockerImage ?? "vuln-workbench-toolbox:local",
						networkMode:
							options.network ?? profile.defaultNetworkMode ?? "none",
						memory: options.memory,
						cpus: options.cpus,
						toolCacheDir: options.toolCacheDir,
					},
				},
				repoPath: project.repoPath,
				outputPath: tempJsonPath,
			});
			const runMetadata = withReproductionRunnerMetadata(
				getReproductionBaseMetadata(runRecord.metadata),
				runResult.executionMetadata,
			);

			// 4. Save stdout / stderr artifacts
			const stdoutArtifact = await this.storage.saveReproductionLog(
				runId,
				"stdout",
				runResult.stdout,
			);
			const dbStdout = await this.repo.createArtifact({
				reproductionRunId: runId,
				findingId: finding.id,
				kind: "stdout",
				format: "text",
				path: stdoutArtifact.path,
				sha256: stdoutArtifact.sha256,
				sizeBytes: stdoutArtifact.sizeBytes,
			});

			const stderrArtifact = await this.storage.saveReproductionLog(
				runId,
				"stderr",
				runResult.stderr,
			);
			const dbStderr = await this.repo.createArtifact({
				reproductionRunId: runId,
				findingId: finding.id,
				kind: "stderr",
				format: "text",
				path: stderrArtifact.path,
				sha256: stderrArtifact.sha256,
				sizeBytes: stderrArtifact.sizeBytes,
			});

			// 5. Handle runToolProcess failure (timeout, docker error, etc.)
			if (!runResult.ok) {
				const { status: finalStatus, failureKind } =
					classifyReproductionExecutionFailure(runResult);

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
					reproductionRunId: runId,
					findingId: finding.id,
					kind: "reproduction-log",
					title: `Sandbox execution failed: ${runResult.error || "Unknown error"}`,
					artifactId: dbStderr.id,
					snippet: runResult.stderr || runResult.error || "No stderr output.",
				});

				return {
					ok: false,
					reproductionRunId: runId,
					findingId: finding.id,
					profileId: profile.id,
					status: finalStatus,
					outcome: "error",
					runner: options.runner,
					exitCode: runResult.exitCode,
					artifactIds: [dbStdout.id, dbStderr.id],
					evidenceIds: [evidence.id],
					message: runResult.error || "Sandbox execution failed",
				};
			}

			// 6. Check if output file was generated
			const fileExists = await fs
				.access(tempJsonPath)
				.then(() => true)
				.catch(() => false);

			if (!fileExists) {
				await this.repo.updateRunStatus(runId, "failed", {
					outcome: "error",
					exitCode: runResult.exitCode,
					errorMessage: "Raw output JSON file was not generated by the tool.",
					metadata: {
						...runMetadata,
						failureKind: "tool_output_missing",
					},
				});

				const evidence = await this.repo.createEvidence({
					reproductionRunId: runId,
					findingId: finding.id,
					kind: "reproduction-log",
					title: "Raw output missing",
					artifactId: dbStderr.id,
					snippet:
						"Tool finished execution but failed to output expected JSON results.",
				});

				return {
					ok: false,
					reproductionRunId: runId,
					findingId: finding.id,
					profileId: profile.id,
					status: "failed",
					outcome: "error",
					runner: options.runner,
					exitCode: runResult.exitCode,
					artifactIds: [dbStdout.id, dbStderr.id],
					evidenceIds: [evidence.id],
					message: "Raw output JSON file was not generated.",
				};
			}

			// 7. Save raw JSON artifact
			const rawArtifact = await this.storage.saveReproductionRawArtifact(
				runId,
				tempJsonPath,
				cmd.rawOutputFileName,
			);
			const dbRaw = await this.repo.createArtifact({
				reproductionRunId: runId,
				findingId: finding.id,
				kind: "raw_result",
				format: "json",
				path: rawArtifact.path,
				sha256: rawArtifact.sha256,
				sizeBytes: rawArtifact.sizeBytes,
			});

			// 8. Parse JSON and evaluate outcome
			let rawOutput: unknown;
			try {
				const jsonContent = await fs.readFile(tempJsonPath, "utf8");
				rawOutput = JSON.parse(jsonContent);
			} catch (err) {
				await this.repo.updateRunStatus(runId, "failed", {
					outcome: "error",
					exitCode: runResult.exitCode,
					errorMessage: `Failed to parse tool output JSON: ${(err as Error).message}`,
					metadata: {
						...runMetadata,
						failureKind: "tool_output_invalid",
					},
				});

				const evidence = await this.repo.createEvidence({
					reproductionRunId: runId,
					findingId: finding.id,
					kind: "reproduction-log",
					title: "Output parsing failed",
					artifactId: dbRaw.id,
					snippet: `Failed to parse tool JSON: ${(err as Error).message}`,
				});

				return {
					ok: false,
					reproductionRunId: runId,
					findingId: finding.id,
					profileId: profile.id,
					status: "failed",
					outcome: "error",
					runner: options.runner,
					exitCode: runResult.exitCode,
					artifactIds: [dbStdout.id, dbStderr.id, dbRaw.id],
					evidenceIds: [evidence.id],
					message: `Output parsing failed: ${(err as Error).message}`,
				};
			}

			const evalResult = profile.evaluate({
				finding,
				stdout: runResult.stdout,
				stderr: runResult.stderr,
				exitCode: runResult.exitCode,
				rawOutput,
			});

			// 9. Update DB run and create evidence
			const updatedMetadata = {
				...runMetadata,
				match: {
					matchedFindingIds: [],
					matchStrength: evalResult.metadata?.matchStrength || "none",
					error: evalResult.metadata?.error || null,
				},
			};
			const finalStatus =
				evalResult.outcome === "error" ? "failed" : "completed";

			await this.repo.updateRunStatus(runId, finalStatus, {
				outcome: evalResult.outcome,
				exitCode: runResult.exitCode,
				metadata: updatedMetadata,
			});

			let evidenceTitle = "";
			let snippetText = "";
			if (evalResult.outcome === "reproduced") {
				evidenceTitle = `Observed again by bounded recheck (Strength: ${evalResult.metadata?.matchStrength || "exact"})`;
				snippetText = `Re-run successfully reproduced the finding. Matching strength: ${evalResult.metadata?.matchStrength}`;
			} else if (evalResult.outcome === "not_reproduced") {
				evidenceTitle = "Finding not observed in current workspace state";
				snippetText =
					"Re-run completed successfully, but no matching finding was detected.";
			} else {
				evidenceTitle = `Reproduction evaluation inconclusive: ${evalResult.metadata?.error || "Unknown cause"}`;
				snippetText = `Evaluation result: ${evalResult.metadata?.error || "Inconclusive results"}`;
			}

			const evidence = await this.repo.createEvidence({
				reproductionRunId: runId,
				findingId: finding.id,
				kind: "reproduction-result",
				title: evidenceTitle,
				artifactId: dbRaw.id,
				snippet: snippetText,
				metadata: evalResult.metadata,
			});

			return {
				ok: finalStatus === "completed",
				reproductionRunId: runId,
				findingId: finding.id,
				profileId: profile.id,
				status: finalStatus,
				outcome: evalResult.outcome,
				runner: options.runner,
				exitCode: runResult.exitCode,
				artifactIds: [dbStdout.id, dbStderr.id, dbRaw.id],
				evidenceIds: [evidence.id],
			};
		} catch (err) {
			// Update DB record on unexpected execution failure
			await this.repo.updateRunStatus(runId, "failed", {
				outcome: "error",
				errorMessage: (err as Error).message,
				metadata: {
					...getReproductionBaseMetadata(runRecord.metadata),
					failureKind: "unknown_error",
				},
			});
			return {
				ok: false,
				reproductionRunId: runId,
				findingId: finding.id,
				profileId: profile.id,
				status: "failed",
				outcome: "error",
				runner: options.runner,
				message: (err as Error).message,
			};
		} finally {
			// 10. Cleanup temp files
			await finalizeTemporaryWorkspace({
				remove: () => fs.rm(tempDir, { recursive: true, force: true }),
				loadRun: () => this.repo.getRun(runId),
				updateRun: (status, update) =>
					this.repo.updateRunStatus(runId, status, update),
				failureCode: "reproduction_workspace_cleanup_failed",
			});
		}
	}
}
