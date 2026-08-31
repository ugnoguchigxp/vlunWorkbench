import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { zizmorOutputSchema } from "../findings/normalizers/zizmor";
import {
	checkToolVersion,
	runToolProcess,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tool-process-runner";

export interface ZizmorRunnerOptions {
	timeoutSec?: number;
	targetPaths?: string[];
	normalizePathsRelativeTo?: string;
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
}

export class ZizmorRunner {
	constructor(
		private readonly storage?: ArtifactStorage,
		private readonly execution?: ToolExecutionConfig,
	) {}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("zizmor", ["--version"], {
			execution: this.execution,
		});
	}

	async run(
		scanRunId: string,
		repoPath: string,
		options: ZizmorRunnerOptions = {},
	) {
		const version = await this.checkVersion();
		if (!version) {
			return {
				ok: false,
				exitCode: null,
				stdout: "",
				stderr: "",
				elapsedMs: 0,
				error: "zizmor executable not found",
			};
		}
		const targets = options.targetPaths?.length
			? options.targetPaths.map((relativePath) => {
					const resolved = path.resolve(repoPath, relativePath);
					const relative = path.relative(repoPath, resolved);
					if (
						relative === ".." ||
						relative.startsWith(`..${path.sep}`) ||
						path.isAbsolute(relative)
					) {
						throw new Error("zizmor target path escaped repository root");
					}
					return resolved;
				})
			: [repoPath];
		const result = await runToolProcess(
			"zizmor",
			[
				"--offline",
				"--format=json-v1",
				"--no-progress",
				"--color=never",
				"--no-exit-codes",
				...targets,
			],
			{
				execution: this.execution,
				repoPath,
				timeoutSec: options.timeoutSec,
				onLifecycleEvent: options.onLifecycleEvent,
			},
		);
		const normalizeRoot = options.normalizePathsRelativeTo ?? repoPath;
		const stdout = normalizeScannerOutputText(result.stdout, normalizeRoot);
		const stderr = normalizeScannerOutputText(result.stderr, normalizeRoot);
		if (!result.ok || result.exitCode !== 0) {
			return {
				...result,
				ok: false,
				stdout,
				stderr,
				error: result.error ?? `zizmor exited with code ${result.exitCode}`,
			};
		}
		let rawJson: unknown;
		try {
			rawJson = normalizeStructuredOutputPaths(
				JSON.parse(result.stdout),
				normalizeRoot,
			);
			zizmorOutputSchema.parse(rawJson);
		} catch {
			return {
				...result,
				ok: false,
				stdout,
				stderr,
				error: "zizmor returned invalid JSON v1 output",
			};
		}
		const redacted = redactJsonSecrets(rawJson);
		let rawJsonArtifact: ArtifactSaveResult | undefined;
		let stdoutArtifact: ArtifactSaveResult | undefined;
		let stderrArtifact: ArtifactSaveResult | undefined;
		if (this.storage) {
			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zizmor-final-"));
			try {
				const jsonPath = path.join(tempDir, "zizmor-result.json");
				await fs.writeFile(jsonPath, JSON.stringify(redacted, null, 2));
				rawJsonArtifact = await this.storage.saveRawArtifact(
					scanRunId,
					jsonPath,
					"zizmor-result.json",
				);
			} finally {
				await cleanupTemporaryPaths(
					[tempDir],
					"zizmor_artifact_workspace_cleanup_failed",
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
			exitCode: result.exitCode,
			stdout,
			stderr,
			elapsedMs: result.elapsedMs,
			rawJson: redacted,
			rawJsonArtifact,
			stdoutArtifact,
			stderrArtifact,
			executionMetadata: {
				...(result.executionMetadata ?? {}),
				offline: true,
				format: "json-v1",
			},
		};
	}
}
