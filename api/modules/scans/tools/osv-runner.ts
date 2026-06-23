import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactStorage, ArtifactSaveResult } from "../artifact-storage";
import { redactJsonSecrets, redactSecrets } from "../normalizers/redaction";
import { checkToolVersion, runToolProcess } from "./tool-process-runner";

export interface OsvRunResult {
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

export interface OsvRunnerOptions {
	timeoutSec?: number;
}

export class OsvRunner {
	constructor(private readonly storage?: ArtifactStorage) {}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("osv-scanner", ["--version"]);
	}

	async run(
		scanRunId: string,
		repoPath: string,
		options: OsvRunnerOptions = {},
	): Promise<OsvRunResult> {
		const version = await this.checkVersion();
		if (!version) {
			return {
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: "",
				elapsedMs: 0,
				error: "OSV-Scanner executable not found",
			};
		}

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "osv-run-"));
		const tempJsonPath = path.join(tempDir, "osv-output.json");

		// Command: osv-scanner --format json --output <tempJsonPath> --recursive <repoPath>
		const args = [
			"--format",
			"json",
			"--output",
			tempJsonPath,
			"--recursive",
			repoPath,
		];

		const startTime = Date.now();
		const runResult = await runToolProcess("osv-scanner", args, {
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
				error: runResult.error || "OSV-Scanner run failed",
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

		// OSV-Scanner exits with 1 when vulnerabilities are found, and 0 when none are found.
		const isCompleted =
			runResult.exitCode === 0 || (runResult.exitCode === 1 && jsonValid);

		if (!isCompleted) {
			let rawJsonArtifact: ArtifactSaveResult | undefined;
			let stdoutArtifact: ArtifactSaveResult | undefined;
			let stderrArtifact: ArtifactSaveResult | undefined;

			if (this.storage) {
				if (rawJsonText !== null) {
					const tempOutDir = await fs.mkdtemp(
						path.join(os.tmpdir(), "osv-invalid-"),
					);
					const finalTempPath = path.join(tempOutDir, "osv-result.json");
					await fs.writeFile(finalTempPath, redactSecrets(rawJsonText));
					rawJsonArtifact = await this.storage.saveRawArtifact(
						scanRunId,
						finalTempPath,
						"osv-result.json",
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
				error: `OSV-Scanner exited with code ${runResult.exitCode}`,
			};
		}

		let rawJsonArtifact: ArtifactSaveResult | undefined;
		let stdoutArtifact: ArtifactSaveResult | undefined;
		let stderrArtifact: ArtifactSaveResult | undefined;

		const redactedRawJson = redactJsonSecrets(rawJson || { results: [] });

		if (this.storage) {
			const tempOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "osv-final-"));
			const finalTempPath = path.join(tempOutDir, "osv-result.json");
			await fs.writeFile(
				finalTempPath,
				JSON.stringify(redactedRawJson, null, 2),
			);

			rawJsonArtifact = await this.storage.saveRawArtifact(
				scanRunId,
				finalTempPath,
				"osv-result.json",
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
