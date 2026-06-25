import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactSaveResult, ArtifactStorage } from "../artifact-storage";
import { redactJsonSecrets, redactSecrets } from "../normalizers/redaction";
import {
	checkToolVersion,
	runToolProcess,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tool-process-runner";

export interface SemgrepRunResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	rawJson?: unknown;
	rawJsonArtifact?: ArtifactSaveResult;
	stdoutArtifact?: ArtifactSaveResult;
	stderrArtifact?: ArtifactSaveResult;
	error?: string;
	executionMetadata?: Record<string, unknown>;
}

export interface SemgrepRunnerOptions {
	config?: string;
	timeoutSec?: number;
	maxTargetBytes?: number;
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
}

export class SemgrepRunner {
	constructor(
		private readonly storage?: ArtifactStorage,
		private readonly execution?: ToolExecutionConfig,
	) {}

	/**
	 * Checks if the semgrep executable is available on the system.
	 * Returns the version string if found, or null otherwise.
	 */
	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("semgrep", ["--version"], {
			execution: this.execution,
		});
	}

	/**
	 * Runs semgrep against a repository path and saves output as artifacts.
	 */
	async run(
		scanRunId: string,
		repoPath: string,
		options: SemgrepRunnerOptions = {},
	): Promise<SemgrepRunResult> {
		const version = await this.checkVersion();
		if (!version) {
			return {
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: "",
				elapsedMs: 0,
				error: "Semgrep executable not found",
			};
		}

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "semgrep-run-"));
		const tempJsonPath = path.join(tempDir, "semgrep-output.json");

		const args = ["scan"];

		const config = options.config ?? "auto";
		args.push("--config", config);

		args.push("--json");
		args.push("--output", tempJsonPath);

		if (options.maxTargetBytes !== undefined) {
			args.push("--max-target-bytes", String(options.maxTargetBytes));
		}

		args.push(repoPath);

		const runResult = await runToolProcess("semgrep", args, {
			timeoutSec: options.timeoutSec,
			execution: this.execution,
			repoPath,
			outputPath: tempJsonPath,
			onLifecycleEvent: options.onLifecycleEvent,
		});
		const { exitCode, stdout, stderr, elapsedMs, executionMetadata } =
			runResult;

		if (!runResult.ok) {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
			return {
				ok: false,
				exitCode: runResult.exitCode,
				stdout,
				stderr,
				elapsedMs,
				error:
					runResult.error === "semgrep execution timed out"
						? "Semgrep execution timed out"
						: (runResult.error ?? "Semgrep run failed"),
				executionMetadata,
			};
		}

		let rawJson: any = null;
		let rawJsonText: string | null = null;
		let jsonValid = false;
		try {
			rawJsonText = await fs.readFile(tempJsonPath, "utf8");
			rawJson = JSON.parse(rawJsonText);
			jsonValid = true;
		} catch {
			// output was invalid or not found
		}

		// Clean up temporary path
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup error
		}

		const isCompleted = exitCode === 0 || (exitCode === 1 && jsonValid);

		if (!isCompleted) {
			let rawJsonArtifact: ArtifactSaveResult | undefined;
			let stdoutArtifact: ArtifactSaveResult | undefined;
			let stderrArtifact: ArtifactSaveResult | undefined;

			if (this.storage) {
				if (rawJsonText !== null) {
					const tempOutDir = await fs.mkdtemp(
						path.join(os.tmpdir(), "semgrep-invalid-"),
					);
					const finalTempPath = path.join(tempOutDir, "semgrep-result.json");
					await fs.writeFile(finalTempPath, redactSecrets(rawJsonText));
					rawJsonArtifact = await this.storage.saveRawArtifact(
						scanRunId,
						finalTempPath,
						"semgrep-result.json",
					);
					await fs.rm(tempOutDir, { recursive: true, force: true });
				}
				if (stdout) {
					stdoutArtifact = await this.storage.saveLog(
						scanRunId,
						"stdout",
						redactSecrets(stdout),
					);
				}
				if (stderr) {
					stderrArtifact = await this.storage.saveLog(
						scanRunId,
						"stderr",
						redactSecrets(stderr),
					);
				}
			}

			return {
				ok: false,
				exitCode,
				stdout,
				stderr,
				elapsedMs,
				rawJsonArtifact,
				stdoutArtifact,
				stderrArtifact,
				error: `Semgrep exited with code ${exitCode}`,
				executionMetadata,
			};
		}

		let rawJsonArtifact: ArtifactSaveResult | undefined;
		let stdoutArtifact: ArtifactSaveResult | undefined;
		let stderrArtifact: ArtifactSaveResult | undefined;
		const redactedRawJson = redactJsonSecrets(rawJson);

		if (this.storage) {
			const tempOutDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "semgrep-final-"),
			);
			const finalTempPath = path.join(tempOutDir, "semgrep-result.json");
			await fs.writeFile(
				finalTempPath,
				JSON.stringify(redactedRawJson, null, 2),
			);

			rawJsonArtifact = await this.storage.saveRawArtifact(
				scanRunId,
				finalTempPath,
				"semgrep-result.json",
			);

			await fs.rm(tempOutDir, { recursive: true, force: true });

			if (stdout) {
				stdoutArtifact = await this.storage.saveLog(
					scanRunId,
					"stdout",
					redactSecrets(stdout),
				);
			}
			if (stderr) {
				stderrArtifact = await this.storage.saveLog(
					scanRunId,
					"stderr",
					redactSecrets(stderr),
				);
			}
		}

		return {
			ok: true,
			exitCode,
			stdout,
			stderr,
			elapsedMs,
			rawJson: redactedRawJson,
			rawJsonArtifact,
			stdoutArtifact,
			stderrArtifact,
			executionMetadata,
		};
	}
}
