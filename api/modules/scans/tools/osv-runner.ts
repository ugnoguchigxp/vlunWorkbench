import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SECURITY_CAPABILITY_DEFAULTS } from "../../../config/appDefaults";
import type { ScanScopePolicy } from "../../../../shared/schemas/scan-profile.schema";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../execution/lifecycle/artifact-storage";
import {
	redactJsonSecrets,
	redactSecrets,
} from "../findings/normalizers/redaction";
import {
	normalizeScannerOutputText,
	normalizeStructuredOutputPaths,
} from "../execution/diff/diff-output-paths";
import { DEPENDENCY_MANIFEST_SCOPE } from "../profiles";
import { createScopedWorkspace } from "../target-scope";
import {
	checkToolVersion,
	runToolProcess,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tool-process-runner";

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
	executionMetadata?: Record<string, unknown>;
}

export interface OsvRunnerOptions {
	timeoutSec?: number;
	scope?: ScanScopePolicy;
	dependencyMode?: "manifest" | "installed_tree";
	normalizePathsRelativeTo?: string;
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
}

export class OsvRunner {
	constructor(
		private readonly storage?: ArtifactStorage,
		private readonly execution?: ToolExecutionConfig,
	) {}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("osv-scanner", ["--version"], {
			execution: this.execution,
		});
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
		let scopedWorkspace: Awaited<
			ReturnType<typeof createScopedWorkspace>
		> | null = null;
		try {
			if (options.dependencyMode === "manifest") {
				const createdWorkspace = await createScopedWorkspace({
					repoPath,
					scope: DEPENDENCY_MANIFEST_SCOPE,
					additionalScope: options.scope,
					prefix: path.join(os.tmpdir(), "osv-manifest-scope-"),
				});
				scopedWorkspace = {
					...createdWorkspace,
					path: await fs.realpath(createdWorkspace.path),
				};
			}
		} catch (error) {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
			throw error;
		}
		const scanPath = scopedWorkspace?.path ?? repoPath;
		const executionMetadata = {
			scopeWorkspace: scopedWorkspace
				? {
						applied: true,
						kind: "dependency_manifest",
						copiedFiles: scopedWorkspace.copiedFiles,
					}
				: { applied: false },
		};

		const offline =
			this.execution?.runner === "docker" ||
			SECURITY_CAPABILITY_DEFAULTS.multiEcosystemOsvEnabled;
		const offlineArgs = offline ? ["--offline", "--no-resolve"] : [];
		const args = [
			"scan",
			"source",
			...offlineArgs,
			"--format",
			"json",
			"--output-file",
			tempJsonPath,
			"--recursive",
			scanPath,
		];

		const startTime = Date.now();
		const runResult = await runToolProcess("osv-scanner", args, {
			timeoutSec: options.timeoutSec,
			execution: this.execution,
			repoPath: scanPath,
			outputPath: tempJsonPath,
			env: offline
				? {
						...process.env,
						OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY:
							process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY ??
							path.resolve(".cache/scanner-data/osv"),
					}
				: undefined,
			onLifecycleEvent: options.onLifecycleEvent,
		});
		const elapsedMs = Date.now() - startTime;
		const outputNormalizationRoot =
			scopedWorkspace?.path ?? options.normalizePathsRelativeTo;
		const stdout = outputNormalizationRoot
			? normalizeScannerOutputText(runResult.stdout, outputNormalizationRoot)
			: runResult.stdout;
		const stderr = outputNormalizationRoot
			? normalizeScannerOutputText(runResult.stderr, outputNormalizationRoot)
			: runResult.stderr;

		if (!runResult.ok && runResult.exitCode !== 1) {
			await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
			await cleanupScopedWorkspace(scopedWorkspace?.path);
			return {
				ok: false,
				exitCode: runResult.exitCode,
				stdout,
				stderr,
				elapsedMs,
				error: runResult.error || "OSV-Scanner run failed",
				executionMetadata: {
					...executionMetadata,
					...(runResult.executionMetadata ?? {}),
				},
			};
		}

		let rawJson: unknown = null;
		let rawJsonText: string | null = null;
		let jsonValid = false;
		try {
			rawJsonText = await fs.readFile(tempJsonPath, "utf8");
			rawJson = JSON.parse(rawJsonText);
			const normalizationRoot =
				scopedWorkspace?.path ?? options.normalizePathsRelativeTo;
			if (normalizationRoot) {
				rawJson = normalizeStructuredOutputPaths(rawJson, normalizationRoot);
				rawJsonText = JSON.stringify(rawJson);
			}
			jsonValid = true;
		} catch {
			// output was invalid or not found
		}

		// Clean up temporary path
		await Promise.all([
			fs.rm(tempDir, { recursive: true, force: true }).catch(() => {}),
			cleanupScopedWorkspace(scopedWorkspace?.path),
		]);

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
				error: `OSV-Scanner exited with code ${runResult.exitCode}`,
				executionMetadata: {
					...executionMetadata,
					...(runResult.executionMetadata ?? {}),
				},
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
			executionMetadata: {
				...executionMetadata,
				...(runResult.executionMetadata ?? {}),
			},
		};
	}
}

async function cleanupScopedWorkspace(workspacePath?: string): Promise<void> {
	if (!workspacePath) return;
	await fs.rm(workspacePath, { recursive: true, force: true }).catch(() => {});
}
