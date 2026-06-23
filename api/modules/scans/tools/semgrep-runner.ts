import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactStorage, ArtifactSaveResult } from "../artifact-storage";
import { redactJsonSecrets, redactSecrets } from "../normalizers/redaction";

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
}

export interface SemgrepRunnerOptions {
	config?: string;
	timeoutSec?: number;
	maxTargetBytes?: number;
}

export class SemgrepRunner {
	constructor(private readonly storage?: ArtifactStorage) {}

	/**
	 * Checks if the semgrep executable is available on the system.
	 * Returns the version string if found, or null otherwise.
	 */
	async checkVersion(): Promise<string | null> {
		try {
			const proc = Bun.spawn(["semgrep", "--version"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) {
				return null;
			}
			const stdoutText = await new Response(proc.stdout).text();
			return stdoutText.trim();
		} catch {
			return null;
		}
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

		const startTime = Date.now();
		let exitCode: number | null = null;
		let stdout = "";
		let stderr = "";
		let proc: any;
		let timeoutId: any;
		let isKilled = false;

		try {
			// Clean environment without sensitive environment keys
			const cleanEnv: Record<string, string> = {};
			for (const [key, val] of Object.entries(process.env)) {
				const normalizedKey = key.toUpperCase();
				if (
					val &&
					!normalizedKey.includes("OPENAI") &&
					!normalizedKey.includes("AZURE") &&
					!normalizedKey.includes("LLM") &&
					!normalizedKey.includes("SECRET") &&
					!normalizedKey.includes("KEY") &&
					!normalizedKey.includes("TOKEN")
				) {
					cleanEnv[key] = val;
				}
			}

			proc = Bun.spawn(["semgrep", ...args], {
				stdout: "pipe",
				stderr: "pipe",
				env: cleanEnv,
			});

			const timeoutSec = options.timeoutSec ?? 300;
			timeoutId = setTimeout(() => {
				isKilled = true;
				proc.kill();
			}, timeoutSec * 1000);

			const [stdoutBuf, stderrBuf, code] = await Promise.all([
				new Response(proc.stdout).arrayBuffer(),
				new Response(proc.stderr).arrayBuffer(),
				proc.exited,
			]);

			exitCode = code;
			stdout = new TextDecoder().decode(stdoutBuf);
			stderr = new TextDecoder().decode(stderrBuf);
		} catch (err: any) {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
			return {
				ok: false,
				exitCode: null,
				stdout,
				stderr: stderr || err.message,
				elapsedMs: Date.now() - startTime,
				error: isKilled
					? "Semgrep execution timed out"
					: `Process error: ${err.message}`,
			};
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}

		const elapsedMs = Date.now() - startTime;

		if (isKilled) {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
			return {
				ok: false,
				exitCode: null,
				stdout,
				stderr,
				elapsedMs,
				error: "Semgrep execution timed out",
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
		};
	}
}
