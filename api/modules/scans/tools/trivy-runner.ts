import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactStorage, ArtifactSaveResult } from "../artifact-storage";
import { redactJsonSecrets, redactSecrets } from "../normalizers/redaction";
import { checkToolVersion, runToolProcess } from "./tool-process-runner";

export interface TrivyRunResult {
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
}

export interface TrivyRunnerOptions {
	timeoutSec?: number;
}

export class TrivyRunner {
	constructor(private readonly storage?: ArtifactStorage) {}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("trivy", ["--version"]);
	}

	async run(
		scanRunId: string,
		repoPath: string,
		options: TrivyRunnerOptions = {},
	): Promise<TrivyRunResult> {
		const version = await this.checkVersion();
		if (!version) {
			return {
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: "",
				elapsedMs: 0,
				error: "Trivy executable not found",
			};
		}

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trivy-run-"));
		const tempJsonPath = path.join(tempDir, "trivy-output.json");

		// Command: trivy fs --format json --output <tempJsonPath> <repoPath>
		const args = ["fs", "--format", "json", "--output", tempJsonPath, repoPath];

		const startTime = Date.now();
		const runResult = await runToolProcess("trivy", args, {
			timeoutSec: options.timeoutSec,
		});
		const elapsedMs = Date.now() - startTime;

		if (!runResult.ok) {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
			return {
				ok: false,
				exitCode: runResult.exitCode,
				stdout: runResult.stdout,
				stderr: runResult.stderr,
				elapsedMs,
				error: runResult.error || "Trivy run failed",
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
			// ignore cleanup
		}

		// Trivy exits with 0 on normal runs even with findings, unless exit-code option is explicitly configured.
		const isCompleted = runResult.exitCode === 0 && jsonValid;

		if (!isCompleted) {
			let rawJsonArtifact: ArtifactSaveResult | undefined;
			let stdoutArtifact: ArtifactSaveResult | undefined;
			let stderrArtifact: ArtifactSaveResult | undefined;

			if (this.storage) {
				if (rawJsonText !== null) {
					const tempOutDir = await fs.mkdtemp(
						path.join(os.tmpdir(), "trivy-invalid-"),
					);
					const finalTempPath = path.join(tempOutDir, "trivy-result.json");
					await fs.writeFile(finalTempPath, redactSecrets(rawJsonText));
					rawJsonArtifact = await this.storage.saveRawArtifact(
						scanRunId,
						finalTempPath,
						"trivy-result.json",
					);
					await fs.rm(tempOutDir, { recursive: true, force: true });
				}
				if (runResult.stdout) {
					stdoutArtifact = await this.storage.saveLog(
						scanRunId,
						"stdout",
						redactSecrets(runResult.stdout),
					);
				}
				if (runResult.stderr) {
					stderrArtifact = await this.storage.saveLog(
						scanRunId,
						"stderr",
						redactSecrets(runResult.stderr),
					);
				}
			}

			return {
				ok: false,
				exitCode: runResult.exitCode,
				stdout: runResult.stdout,
				stderr: runResult.stderr,
				elapsedMs,
				rawJsonArtifact,
				stdoutArtifact,
				stderrArtifact,
				error: `Trivy exited with code ${runResult.exitCode}`,
			};
		}

		let rawJsonArtifact: ArtifactSaveResult | undefined;
		let stdoutArtifact: ArtifactSaveResult | undefined;
		let stderrArtifact: ArtifactSaveResult | undefined;

		const redactedRawJson = redactJsonSecrets(rawJson || { Results: [] });

		if (this.storage) {
			const tempOutDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "trivy-final-"),
			);
			const finalTempPath = path.join(tempOutDir, "trivy-result.json");
			await fs.writeFile(
				finalTempPath,
				JSON.stringify(redactedRawJson, null, 2),
			);

			rawJsonArtifact = await this.storage.saveRawArtifact(
				scanRunId,
				finalTempPath,
				"trivy-result.json",
			);

			await fs.rm(tempOutDir, { recursive: true, force: true });

			if (runResult.stdout) {
				stdoutArtifact = await this.storage.saveLog(
					scanRunId,
					"stdout",
					redactSecrets(runResult.stdout),
				);
			}
			if (runResult.stderr) {
				stderrArtifact = await this.storage.saveLog(
					scanRunId,
					"stderr",
					redactSecrets(runResult.stderr),
				);
			}
		}

		return {
			ok: true,
			exitCode: runResult.exitCode,
			stdout: runResult.stdout,
			stderr: runResult.stderr,
			elapsedMs,
			rawJson: redactedRawJson,
			rawJsonArtifact,
			stdoutArtifact,
			stderrArtifact,
		};
	}
}
