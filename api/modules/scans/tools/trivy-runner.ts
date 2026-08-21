import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanScopePolicy } from "../../../../shared/schemas/scan-profile.schema";
import type { ArtifactSaveResult, ArtifactStorage } from "../artifact-storage";
import {
	normalizeScannerOutputText,
	normalizeStructuredOutputPaths,
} from "../diff-output-paths";
import { redactJsonSecrets, redactSecrets } from "../normalizers/redaction";
import { createScopedWorkspace, getScopeSkipDirs } from "../target-scope";
import {
	checkToolVersion,
	runToolProcess,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tool-process-runner";

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
	executionMetadata?: Record<string, unknown>;
}

export interface TrivyRunnerOptions {
	timeoutSec?: number;
	scope?: ScanScopePolicy;
	scanners?: string[];
	mode?: "fs-vulnerability" | "fs-sbom" | "image";
	imageRef?: string;
	imageTar?: string;
	normalizePathsRelativeTo?: string;
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
}

export class TrivyRunner {
	constructor(
		private readonly storage?: ArtifactStorage,
		private readonly execution?: ToolExecutionConfig,
	) {}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("trivy", ["--version"], {
			execution: this.execution,
		});
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
		const mode = options.mode ?? "fs-vulnerability";
		if (mode === "image" && !options.imageRef && !options.imageTar) {
			return {
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: "",
				elapsedMs: 0,
				error: "image_input_not_provided",
			};
		}

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trivy-run-"));
		const tempJsonPath = path.join(
			tempDir,
			options.mode === "fs-sbom" ? "sbom.cdx.json" : "trivy-output.json",
		);
		const scopedWorkspace =
			options.scope?.intent === "artifact" ||
			options.scope?.intent === "dependency_manifest"
				? await createScopedWorkspace({
						repoPath,
						scope: options.scope,
						prefix: path.join(os.tmpdir(), "trivy-scope-"),
					})
				: null;
		const scanPath = scopedWorkspace?.path ?? repoPath;

		const args =
			mode === "fs-sbom"
				? ["fs", "--format", "cyclonedx", "--output", tempJsonPath]
				: mode === "image"
					? [
							"image",
							"--format",
							"json",
							// Image E2E must prove package coverage, not merely that the
							// image command started. This is also useful production evidence.
							"--list-all-pkgs",
							"--output",
							tempJsonPath,
							...(options.imageRef
								? [options.imageRef]
								: ["--input", options.imageTar as string]),
						]
					: ["fs", "--format", "json", "--output", tempJsonPath];
		if (options.scanners?.length) {
			args.push("--scanners", options.scanners.join(","));
		}
		if (this.execution?.runner === "docker" && mode !== "fs-sbom") {
			const cacheDir = this.execution.docker?.toolCacheDir
				? "/workspace/cache/trivy"
				: "/opt/vuln-workbench/scanner-data/trivy";
			args.push(
				"--cache-dir",
				cacheDir,
				"--skip-db-update",
				"--skip-java-db-update",
				"--offline-scan",
			);
		}
		if (mode === "fs-vulnerability" && !scopedWorkspace) {
			for (const skipDir of getScopeSkipDirs(options.scope)) {
				args.push("--skip-dirs", skipDir);
			}
		}
		if (mode !== "image") args.push(scanPath);

		const startTime = Date.now();
		const runResult = await runToolProcess("trivy", args, {
			timeoutSec: options.timeoutSec,
			execution: this.execution,
			repoPath: scanPath,
			inputPaths: options.imageTar ? [options.imageTar] : undefined,
			outputPath: tempJsonPath,
			onLifecycleEvent: options.onLifecycleEvent,
		});
		const elapsedMs = Date.now() - startTime;
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
		const executionMetadata: Record<string, unknown> = {
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
				error: runResult.error || "Trivy run failed",
				executionMetadata,
			};
		}

		let rawJson: unknown = null;
		let rawJsonText: string | null = null;
		let jsonValid = false;
		try {
			rawJsonText = await fs.readFile(tempJsonPath, "utf8");
			rawJson = JSON.parse(rawJsonText);
			if (options.normalizePathsRelativeTo && mode !== "fs-sbom") {
				rawJson = normalizeStructuredOutputPaths(
					rawJson,
					options.normalizePathsRelativeTo,
				);
				rawJsonText = JSON.stringify(rawJson);
			}
			jsonValid = true;
			if (mode === "fs-sbom" && rawJson && typeof rawJson === "object") {
				const sbom = rawJson as {
					components?: unknown[];
					dependencies?: unknown[];
				};
				executionMetadata.sbom = {
					format: "cyclonedx-json",
					componentCount: sbom.components?.length ?? 0,
					dependencyRelationshipCount: sbom.dependencies?.length ?? 0,
				};
			}
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
				error: `Trivy exited with code ${runResult.exitCode}`,
				executionMetadata,
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
