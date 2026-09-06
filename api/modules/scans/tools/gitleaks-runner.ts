import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanScopePolicy } from "../../../../shared/schemas/scan-profile.schema";
import {
	normalizeScannerOutputText,
	normalizeStructuredOutputPaths,
} from "../execution/diff/diff-output-paths";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../execution/lifecycle/artifact-storage";
import { cleanupTemporaryPaths } from "../execution/lifecycle/temporary-path-cleanup";
import {
	redactJsonSecrets,
	redactSecrets,
} from "../findings/normalizers/redaction";
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
	/** Immutable repository config supplied separately from a diff workspace. */
	configPath?: string;
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
		let scopedWorkspace: Awaited<
			ReturnType<typeof createScopedWorkspace>
		> | null = null;
		try {
			if (this.execution?.runner === "docker") {
				// The toolbox runs as a fixed non-root UID. On native Linux bind mounts,
				// a report created by that UID can be unreadable by the host runner when
				// the daemon applies a restrictive umask. Create an invalid empty
				// sentinel as the host user, then make only this isolated output writable
				// for the container. Gitleaks truncates the existing file on success.
				await fs.writeFile(tempJsonPath, "", { flag: "wx", mode: 0o600 });
				await fs.chmod(tempJsonPath, 0o666);
			}
			if (
				!options.preScoped &&
				options.scope?.intent &&
				options.scope.intent !== "full_deep"
			) {
				scopedWorkspace = await createScopedWorkspace({
					repoPath,
					scope: options.scope,
					prefix: path.join(os.tmpdir(), "gitleaks-scope-"),
				});
			}
		} catch (error) {
			await cleanupTemporaryPaths(
				[tempDir],
				"gitleaks_workspace_cleanup_failed",
			);
			throw error;
		}
		const scanPath = scopedWorkspace?.path ?? repoPath;
		const scannerSource = this.execution?.runner === "docker" ? "." : scanPath;

		// Command: gitleaks detect --source <repoPath> --report-format json --report-path <tempJsonPath> --redact
		const args = [
			"detect",
			"--source",
			scannerSource,
			"--report-format",
			"json",
			"--report-path",
			tempJsonPath,
			"--redact",
		];
		const repositoryConfigPath =
			options.configPath ?? path.join(scanPath, ".gitleaks.toml");
		const resolvedConfigPath = (await isRegularFile(repositoryConfigPath))
			? repositoryConfigPath
			: null;
		if (resolvedConfigPath) {
			// Gitleaks discovers its default config relative to the process working
			// directory, which is not guaranteed to be the mounted repository when
			// running in the toolbox container. Bind the repository-owned config
			// explicitly so scoped and direct scans apply the same rules.
			args.push("--config", resolvedConfigPath);
		}
		const gitHistoryAvailable = await hasUsableGitMetadata(
			scanPath,
			this.execution?.runner === "docker",
		);
		const scanMode =
			scopedWorkspace || options.preScoped || !gitHistoryAvailable
				? "filesystem"
				: "git_history";
		if (scanMode === "filesystem") args.push("--no-git");

		const startTime = Date.now();
		let runResult: Awaited<ReturnType<typeof runToolProcess>>;
		try {
			runResult = await runToolProcess("gitleaks", args, {
				timeoutSec: options.timeoutSec,
				execution: this.execution,
				repoPath: scanPath,
				inputPaths:
					resolvedConfigPath && options.configPath
						? [resolvedConfigPath]
						: undefined,
				outputPath: tempJsonPath,
				onLifecycleEvent: options.onLifecycleEvent,
			});
		} catch (error) {
			await cleanupTemporaryPaths(
				[tempDir, scopedWorkspace?.path],
				"gitleaks_workspace_cleanup_failed",
			);
			throw error;
		} finally {
			if (this.execution?.runner === "docker") {
				await fs.chmod(tempJsonPath, 0o600).catch(() => {});
			}
		}
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
			scanMode,
			scopeWorkspace: scopedWorkspace
				? { applied: true, copiedFiles: scopedWorkspace.copiedFiles }
				: { applied: false },
		};

		if (!runResult.ok) {
			await cleanupTemporaryPaths(
				[tempDir, scopedWorkspace?.path],
				"gitleaks_workspace_cleanup_failed",
			);
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
		await cleanupTemporaryPaths(
			[tempDir, scopedWorkspace?.path],
			"gitleaks_workspace_cleanup_failed",
		);

		// Gitleaks exit code 0 = no leaks, 1 = leaks found (both completed scans)
		// A Git fatal accompanied by an empty report used to look like a clean
		// scan because some Gitleaks releases still exit 0. Never accept that as
		// evidence from history mode.
		const gitHistoryFailed =
			scanMode === "git_history" && hasFatalGitDiagnostic(stderr);
		const isCompleted =
			!gitHistoryFailed &&
			(runResult.exitCode === 0 || (runResult.exitCode === 1 && jsonValid));

		if (!isCompleted) {
			let rawJsonArtifact: ArtifactSaveResult | undefined;
			let stdoutArtifact: ArtifactSaveResult | undefined;
			let stderrArtifact: ArtifactSaveResult | undefined;

			if (this.storage) {
				if (rawJsonText !== null) {
					const tempOutDir = await fs.mkdtemp(
						path.join(os.tmpdir(), "gitleaks-invalid-"),
					);
					try {
						const finalTempPath = path.join(tempOutDir, "gitleaks-result.json");
						await fs.writeFile(finalTempPath, redactSecrets(rawJsonText));
						rawJsonArtifact = await this.storage.saveRawArtifact(
							scanRunId,
							finalTempPath,
							"gitleaks-result.json",
						);
					} finally {
						await cleanupTemporaryPaths(
							[tempOutDir],
							"gitleaks_artifact_workspace_cleanup_failed",
						);
					}
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

			const diagnostic = compactDiagnostic(stderr);
			return {
				ok: false,
				exitCode: runResult.exitCode,
				stdout,
				stderr,
				elapsedMs,
				rawJsonArtifact,
				stdoutArtifact,
				stderrArtifact,
				error: `Gitleaks exited with code ${runResult.exitCode}${diagnostic ? `: ${diagnostic}` : ""}`,
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
			try {
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
			} finally {
				await cleanupTemporaryPaths(
					[tempOutDir],
					"gitleaks_artifact_workspace_cleanup_failed",
				);
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

async function isRegularFile(filePath: string): Promise<boolean> {
	try {
		return (await fs.lstat(filePath)).isFile();
	} catch {
		return false;
	}
}

async function hasUsableGitMetadata(
	repoPath: string,
	dockerRunner: boolean,
): Promise<boolean> {
	try {
		const metadata = await fs.lstat(path.join(repoPath, ".git"));
		if (metadata.isDirectory()) return true;
		// A linked worktree's .git file points outside the repository mount and
		// cannot be followed by the isolated Docker scanner.
		return metadata.isFile() && !dockerRunner;
	} catch {
		return false;
	}
}

function hasFatalGitDiagnostic(stderr: string): boolean {
	const plain = stderr.replace(
		new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"),
		"",
	);
	return (
		/\[git\].*\bfatal:/i.test(plain) ||
		/not a git repository/i.test(plain) ||
		/dubious ownership in repository/i.test(plain)
	);
}

function compactDiagnostic(stderr: string): string {
	return redactSecrets(stderr)
		.replace(
			new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"),
			"",
		)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 512);
}
