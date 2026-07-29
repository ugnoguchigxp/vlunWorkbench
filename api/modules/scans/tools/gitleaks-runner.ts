import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanScopePolicy } from "../../../../shared/schemas/scan-profile.schema";
import type { ArtifactSaveResult, ArtifactStorage } from "../artifact-storage";
import { redactJsonSecrets, redactSecrets } from "../normalizers/redaction";
import {
	normalizeScannerOutputText,
	normalizeStructuredOutputPaths,
} from "../diff-output-paths";
import { createScopedWorkspace } from "../target-scope";
import {
	checkToolVersion,
	runToolProcess,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tool-process-runner";

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
	executionMetadata?: Record<string, unknown>;
}

export interface GitleaksRunnerOptions {
	timeoutSec?: number;
	scope?: ScanScopePolicy;
	preScoped?: boolean;
	normalizePathsRelativeTo?: string;
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
}

export class GitleaksRunner {
	constructor(
		private readonly storage?: ArtifactStorage,
		private readonly execution?: ToolExecutionConfig,
	) {}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("gitleaks", ["version"], {
			execution: this.execution,
		});
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
		const scopedWorkspace =
			!options.preScoped &&
			options.scope?.intent &&
			options.scope.intent !== "full_deep"
				? await createScopedWorkspace({
						repoPath,
						scope: options.scope,
						prefix: path.join(os.tmpdir(), "gitleaks-scope-"),
					})
				: null;
		const scanPath = scopedWorkspace?.path ?? repoPath;

		// Command: gitleaks detect --source <repoPath> --report-format json --report-path <tempJsonPath> --redact
		const args = [
			"detect",
			"--source",
			scanPath,
			"--report-format",
			"json",
			"--report-path",
			tempJsonPath,
			"--redact",
		];
		if (scopedWorkspace || options.preScoped) args.push("--no-git");

		const startTime = Date.now();
		const runResult = await runToolProcess("gitleaks", args, {
			timeoutSec: options.timeoutSec,
			execution: this.execution,
			repoPath: scanPath,
			outputPath: tempJsonPath,
			onLifecycleEvent: options.onLifecycleEvent,
		});
		const stdout = options.normalizePathsRelativeTo
			? normalizeScannerOutputText(
					runResult.stdout,
					options.normalizePathsRelativeTo,
				)
			: runResult.stdout;
		const stderr = options.normalizePathsRelativeTo
			? normalizeScannerOutputText(
					runResult.stderr,
					options.normalizePathsRelativeTo,
				)
			: runResult.stderr;
		const elapsedMs = Date.now() - startTime;
		const executionMetadata = {
			...(runResult.executionMetadata ?? {}),
			scopeWorkspace: scopedWorkspace
				? { applied: true, copiedFiles: scopedWorkspace.copiedFiles }
				: { applied: false },
		};

		if (!runResult.ok) {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
			if (scopedWorkspace) {
				await fs
					.rm(scopedWorkspace.path, { recursive: true, force: true })
					.catch(() => {});
			}
			return {
				ok: false,
				exitCode: runResult.exitCode,
				stdout,
				stderr,
				elapsedMs,
				error: runResult.error || "Gitleaks run failed",
				executionMetadata,
			};
		}

		let rawJson: unknown = null;
		let rawJsonText: string | null = null;
		let jsonValid = false;
		try {
			rawJsonText = await fs.readFile(tempJsonPath, "utf8");
			rawJson = JSON.parse(rawJsonText);
			if (options.normalizePathsRelativeTo) {
				rawJson = normalizeStructuredOutputPaths(
					rawJson,
					options.normalizePathsRelativeTo,
				);
				rawJsonText = JSON.stringify(rawJson);
			}
			jsonValid = true;
		} catch {
			// output was invalid or not found
		}

		// Clean up temporary path
		try {
			await fs.rm(tempDir, { recursive: true, force: true });
			if (scopedWorkspace) {
				await fs.rm(scopedWorkspace.path, { recursive: true, force: true });
			}
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
				exitCode: runResult.exitCode,
				stdout,
				stderr,
				elapsedMs,
				rawJsonArtifact,
				stdoutArtifact,
				stderrArtifact,
				error: `Gitleaks exited with code ${runResult.exitCode}`,
				executionMetadata,
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
			exitCode: runResult.exitCode,
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
