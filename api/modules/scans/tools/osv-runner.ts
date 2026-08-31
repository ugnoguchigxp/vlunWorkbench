import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DependencyResolutionMode } from "../../../../shared/schemas/maven-resolution.schema";
import type { ScanScopePolicy } from "../../../../shared/schemas/scan-profile.schema";
import { SECURITY_CAPABILITY_DEFAULTS } from "../../../config/appDefaults";
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
import { DEPENDENCY_MANIFEST_SCOPE } from "../profiles";
import { createScopedWorkspace } from "../target-scope";
import { resolveMavenDependencies } from "./maven-resolver-runner";
import {
	checkToolVersion,
	getCleanEnv,
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
	additionalArtifacts?: Array<{
		role: "sbom" | "runtime_diagnostic";
		format: string;
		saved: ArtifactSaveResult;
		metadata?: Record<string, unknown>;
	}>;
	error?: string;
	executionMetadata?: Record<string, unknown>;
}

export interface OsvRunnerOptions {
	timeoutSec?: number;
	scope?: ScanScopePolicy;
	dependencyMode?: "manifest" | "installed_tree";
	dependencyResolutionMode?: DependencyResolutionMode;
	mavenResolverImage?: string;
	mavenResolverImageId?: string;
	mavenResolverImageDigest?: string | null;
	mavenResolutionConfigDigest?: string;
	mavenResolutionSourceDigest?: string;
	mavenResolutionConfig?: unknown;
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
		let resolverCleanup: (() => Promise<void>) | undefined;
		const cleanupInputs = async (paths: Array<string | null | undefined>) => {
			await cleanupTemporaryPaths(paths, "osv_workspace_cleanup_failed");
			await resolverCleanup?.();
			resolverCleanup = undefined;
		};
		let scopedWorkspace: Awaited<
			ReturnType<typeof createScopedWorkspace>
		> | null = null;
		try {
			if (
				options.dependencyMode === "manifest" &&
				options.dependencyResolutionMode !== "registry"
			) {
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
			await cleanupInputs([tempDir]);
			throw error;
		}
		let resolvedSbomPath: string | undefined;
		let resolverArtifacts: OsvRunResult["additionalArtifacts"] = [];
		let resolverMetadata: Record<string, unknown> = {};
		if (options.dependencyResolutionMode === "registry") {
			if (!options.mavenResolverImage || !options.mavenResolverImageId) {
				await cleanupInputs([tempDir, scopedWorkspace?.path]);
				return {
					ok: false,
					exitCode: null,
					stdout: "",
					stderr: "",
					elapsedMs: 0,
					error: !options.mavenResolverImage
						? "maven_resolver_image_not_configured"
						: "maven_resolver_image_id_unavailable",
				};
			}
			let resolution: Awaited<ReturnType<typeof resolveMavenDependencies>>;
			try {
				resolution = await resolveMavenDependencies({
					scanRunId,
					repoPath,
					storage: this.storage,
					execution: this.execution ?? { runner: "host" },
					resolverImage: options.mavenResolverImage,
					resolverImageId: options.mavenResolverImageId,
					resolverImageDigest: options.mavenResolverImageDigest,
					expectedConfigDigest: options.mavenResolutionConfigDigest,
					expectedSourceDigest: options.mavenResolutionSourceDigest,
					mavenResolutionConfig: options.mavenResolutionConfig,
					timeoutSec: options.timeoutSec,
					onLifecycleEvent: options.onLifecycleEvent,
				});
			} catch (error) {
				await cleanupInputs([tempDir, scopedWorkspace?.path]);
				throw error;
			}
			resolverCleanup = resolution.cleanup;
			resolverArtifacts = [
				...(resolution.sbomArtifact
					? [
							{
								role: "sbom" as const,
								format: "cyclonedx-json",
								saved: resolution.sbomArtifact,
								metadata: {
									resolver: "maven",
									resolved: true,
									sbomDigest: resolution.receipt.sbomDigest,
								},
							},
						]
					: []),
				...(resolution.receiptArtifact
					? [
							{
								role: "runtime_diagnostic" as const,
								format: "json",
								saved: resolution.receiptArtifact,
								metadata: { resolver: "maven" },
							},
						]
					: []),
			];
			resolverMetadata = {
				dependencyResolution: {
					mode: "registry",
					resolverImage: resolution.receipt.resolverImage,
					resolverImageId: resolution.receipt.resolverImageId,
					resolverImageDigest: resolution.receipt.resolverImageDigest,
					configDigest: resolution.receipt.configDigest,
					sourceDigest: resolution.receipt.sourceDigest,
					sbomDigest: resolution.receipt.sbomDigest,
					componentCounts: resolution.receipt.componentCounts,
					unresolvedCoordinates: resolution.receipt.unresolvedCoordinates,
					resolverExecution: resolution.executionMetadata,
				},
			};
			if (!resolution.ok || !resolution.sbomPath) {
				await cleanupInputs([tempDir, scopedWorkspace?.path]);
				const stdoutArtifact =
					this.storage && resolution.stdout
						? await this.storage.saveLog(
								scanRunId,
								"stdout",
								redactSecrets(resolution.stdout),
							)
						: undefined;
				const stderrArtifact =
					this.storage && resolution.stderr
						? await this.storage.saveLog(
								scanRunId,
								"stderr",
								redactSecrets(resolution.stderr),
							)
						: undefined;
				return {
					ok: false,
					exitCode: resolution.exitCode,
					stdout: resolution.stdout,
					stderr: resolution.stderr,
					elapsedMs: resolution.elapsedMs,
					error: resolution.error ?? "maven_dependency_resolution_failed",
					stdoutArtifact,
					stderrArtifact,
					additionalArtifacts: resolverArtifacts,
					executionMetadata: resolverMetadata,
				};
			}
			resolvedSbomPath = resolution.sbomPath;
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
			dependencyResolution: {
				mode: options.dependencyResolutionMode ?? "offline",
			},
			...resolverMetadata,
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
			...(resolvedSbomPath
				? ["--lockfile", resolvedSbomPath]
				: ["--recursive", scanPath]),
		];

		const startTime = Date.now();
		let runResult: Awaited<ReturnType<typeof runToolProcess>>;
		try {
			runResult = await runToolProcess("osv-scanner", args, {
				timeoutSec: options.timeoutSec,
				execution: this.execution,
				repoPath: scanPath,
				inputPaths: resolvedSbomPath ? [resolvedSbomPath] : undefined,
				outputPath: tempJsonPath,
				env: offline
					? {
							...getCleanEnv(),
							OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY:
								process.env.OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY ??
								path.resolve(".cache/scanner-data/osv"),
						}
					: undefined,
				onLifecycleEvent: options.onLifecycleEvent,
			});
		} catch (error) {
			await cleanupInputs([tempDir, scopedWorkspace?.path]);
			throw error;
		}
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
			await cleanupInputs([tempDir, scopedWorkspace?.path]);
			return {
				ok: false,
				exitCode: runResult.exitCode,
				stdout,
				stderr,
				elapsedMs,
				error: runResult.error || "OSV-Scanner run failed",
				additionalArtifacts: resolverArtifacts,
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
		await cleanupInputs([tempDir, scopedWorkspace?.path]);

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
					try {
						const finalTempPath = path.join(tempOutDir, "osv-result.json");
						await fs.writeFile(finalTempPath, redactSecrets(rawJsonText));
						rawJsonArtifact = await this.storage.saveRawArtifact(
							scanRunId,
							finalTempPath,
							"osv-result.json",
						);
					} finally {
						await cleanupTemporaryPaths(
							[tempOutDir],
							"osv_artifact_workspace_cleanup_failed",
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

			return {
				ok: false,
				exitCode: runResult.exitCode,
				stdout,
				stderr,
				elapsedMs,
				rawJsonArtifact,
				stdoutArtifact,
				stderrArtifact,
				additionalArtifacts: resolverArtifacts,
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
			try {
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
			} finally {
				await cleanupTemporaryPaths(
					[tempOutDir],
					"osv_artifact_workspace_cleanup_failed",
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
			additionalArtifacts: resolverArtifacts,
			executionMetadata: {
				...executionMetadata,
				...(runResult.executionMetadata ?? {}),
			},
		};
	}
}
