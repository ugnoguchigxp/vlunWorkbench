import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactStorage, ArtifactSaveResult } from "../artifact-storage";
import { redactJsonSecrets, redactSecrets } from "../normalizers/redaction";
import { checkToolVersion, runToolProcess } from "./tool-process-runner";

export interface GitleaksRunResult {
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

export interface GitleaksRunnerOptions {
	timeoutSec?: number;
}

export class GitleaksRunner {
	constructor(private readonly storage?: ArtifactStorage) {}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("gitleaks", ["version"]);
	}

	async run(
		scanRunId: string,
		repoPath: string,
		options: GitleaksRunnerOptions = {},
	): Promise<GitleaksRunResult> {
		const version = await this.checkVersion();
		if (!version) {
			return {
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: "",
				elapsedMs: 0,
				error: "Gitleaks executable not found",
			};
		}

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitleaks-run-"));
		const tempJsonPath = path.join(tempDir, "gitleaks-output.json");

		// Command: gitleaks detect --source <repoPath> --report-format json --report-path <tempJsonPath> --redact
		const args = [
			"detect",
			"--source",
			repoPath,
			"--report-format",
			"json",
			"--report-path",
			tempJsonPath,
			"--redact",
		];

		const startTime = Date.now();
		const runResult = await runToolProcess("gitleaks", args, {
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
				error: runResult.error || "Gitleaks run failed",
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

		// Gitleaks exit code 0 = no leaks, 1 = leaks found (both completed scans)
		const isCompleted =
			runResult.exitCode === 0 || (runResult.exitCode === 1 && jsonValid);

		if (!isCompleted) {
			let rawJsonArtifact: ArtifactSaveResult | undefined;
			let stdoutArtifact: ArtifactSaveResult | undefined;
			let stderrArtifact: ArtifactSaveResult | undefined;

			if (this.storage) {
				if (rawJsonText !== null) {
					const tempOutDir = await fs.mkdtemp(
						path.join(os.tmpdir(), "gitleaks-invalid-"),
					);
					const finalTempPath = path.join(tempOutDir, "gitleaks-result.json");
					await fs.writeFile(finalTempPath, redactSecrets(rawJsonText));
					rawJsonArtifact = await this.storage.saveRawArtifact(
						scanRunId,
						finalTempPath,
						"gitleaks-result.json",
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
				error: `Gitleaks exited with code ${runResult.exitCode}`,
			};
		}

		let rawJsonArtifact: ArtifactSaveResult | undefined;
		let stdoutArtifact: ArtifactSaveResult | undefined;
		let stderrArtifact: ArtifactSaveResult | undefined;

		const redactedRawJson = redactJsonSecrets(rawJson || []);

		if (this.storage) {
			const tempOutDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "gitleaks-final-"),
			);
			const finalTempPath = path.join(tempOutDir, "gitleaks-result.json");
			await fs.writeFile(
				finalTempPath,
				JSON.stringify(redactedRawJson, null, 2),
			);

			rawJsonArtifact = await this.storage.saveRawArtifact(
				scanRunId,
				finalTempPath,
				"gitleaks-result.json",
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
