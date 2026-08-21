import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanScopePolicy } from "../../../../shared/schemas/scan-profile.schema";
import type { SemgrepRuleContribution } from "../../project-capabilities/plugin-contract";
import { isSafeRelativePluginPath } from "../../project-capabilities/path-patterns";
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
import { getScopeExcludeGlobs, getScopeIncludeGlobs } from "../target-scope";
import {
	checkToolVersion,
	runToolProcess,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tool-process-runner";
import { filterOwnedJavaTaintResults } from "./java-taint-precision-filter";

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
	scope?: ScanScopePolicy;
	targetPaths?: string[];
	normalizePathsRelativeTo?: string;
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
	ruleContributions?: SemgrepRuleContribution[];
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

		const configs = await resolveSemgrepConfigs(
			options.config,
			options.ruleContributions,
			this.execution,
		);
		for (const config of configs) args.push("--config", config);

		args.push("--json");
		args.push("--output", tempJsonPath);

		if (options.maxTargetBytes !== undefined) {
			args.push("--max-target-bytes", String(options.maxTargetBytes));
		}
		for (const includeGlob of getScopeIncludeGlobs(options.scope)) {
			if (includeGlob !== "**/*") {
				args.push("--include", includeGlob);
			}
		}
		for (const excludeGlob of getScopeExcludeGlobs(options.scope)) {
			args.push("--exclude", excludeGlob);
		}

		const targetPaths = options.targetPaths?.length
			? options.targetPaths.map((relativePath) => {
					const absolutePath = path.resolve(repoPath, relativePath);
					const relative = path.relative(repoPath, absolutePath);
					if (
						relative === ".." ||
						relative.startsWith(`..${path.sep}`) ||
						path.isAbsolute(relative)
					) {
						throw new Error("Semgrep target path escaped the repository root.");
					}
					return absolutePath;
				})
			: [repoPath];
		args.push(...targetPaths);

		const runResult = await runToolProcess("semgrep", args, {
			timeoutSec: options.timeoutSec,
			execution: this.execution,
			repoPath,
			outputPath: tempJsonPath,
			onLifecycleEvent: options.onLifecycleEvent,
		});
		const {
			exitCode,
			stdout: rawStdout,
			stderr: rawStderr,
			elapsedMs,
			executionMetadata,
		} = runResult;
		const stdout = options.normalizePathsRelativeTo
			? normalizeScannerOutputText(rawStdout, options.normalizePathsRelativeTo)
			: rawStdout;
		const stderr = options.normalizePathsRelativeTo
			? normalizeScannerOutputText(rawStderr, options.normalizePathsRelativeTo)
			: rawStderr;

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

		let rawJson: unknown = null;
		let rawJsonText: string | null = null;
		let jsonValid = false;
		let javaTaintPrecisionSuppressionCount = 0;
		try {
			rawJsonText = await fs.readFile(tempJsonPath, "utf8");
			rawJson = JSON.parse(rawJsonText);
			const precisionFiltered = await filterOwnedJavaTaintResults(rawJson);
			rawJson = precisionFiltered.output;
			javaTaintPrecisionSuppressionCount =
				precisionFiltered.suppressions.length;
			rawJsonText = JSON.stringify(rawJson);
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
			executionMetadata: {
				...executionMetadata,
				javaTaintPrecisionSuppressionCount,
			},
		};
	}
}

async function resolveSemgrepConfigs(
	config: string | undefined,
	contributions: SemgrepRuleContribution[] | undefined,
	execution: ToolExecutionConfig | undefined,
): Promise<string[]> {
	if (contributions && contributions.length > 0) {
		const sourceRoot = path.resolve(
			process.cwd(),
			"docker/toolbox/scanner-data/semgrep-rules",
		);
		const configs: string[] = [];
		for (const contribution of [...contributions].sort((left, right) =>
			left.path.localeCompare(right.path),
		)) {
			if (!isSafeRelativePluginPath(contribution.path)) {
				throw new Error(`plugin_asset_path_invalid:${contribution.pluginId}`);
			}
			const sourcePath = path.resolve(sourceRoot, contribution.path);
			const relative = path.relative(sourceRoot, sourcePath);
			if (
				relative === ".." ||
				relative.startsWith(`..${path.sep}`) ||
				path.isAbsolute(relative)
			) {
				throw new Error(`plugin_asset_path_invalid:${contribution.pluginId}`);
			}
			const digest = `sha256:${crypto
				.createHash("sha256")
				.update(await fs.readFile(sourcePath))
				.digest("hex")}`;
			if (digest !== contribution.digest) {
				throw new Error(
					`semgrep_rule_digest_mismatch:${contribution.pluginId}:${contribution.path}`,
				);
			}
			configs.push(
				execution?.runner === "docker"
					? path.posix.join(
							"/opt/vuln-workbench/scanner-data/semgrep-rules",
							contribution.path,
						)
					: sourcePath,
			);
		}
		return configs;
	}
	if (
		config !== undefined &&
		config !== "owned" &&
		config !== "curated-sast-v1"
	)
		return [config];
	if (execution?.runner === "docker") {
		return ["/opt/vuln-workbench/scanner-data/semgrep-rules"];
	}
	return [
		path.resolve(process.cwd(), "docker/toolbox/scanner-data/semgrep-rules"),
	];
}
