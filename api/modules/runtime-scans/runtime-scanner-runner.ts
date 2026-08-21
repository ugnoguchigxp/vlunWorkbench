import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import { cleanupTemporaryPaths } from "../scans/execution/lifecycle/temporary-path-cleanup";
import { redactSecrets } from "../scans/normalizers/redaction";
import {
	runToolProcess,
	checkToolVersion,
	getCleanEnv,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "../scans/tools/tool-process-runner";
import { buildNucleiSafeCommand } from "./command-contracts";
import { normalizeNuclei } from "./nuclei-normalizer";

export type RuntimeScannerAdapter = "nuclei-safe";

export type RuntimeScannerRunResult = {
	ok: boolean;
	exitCode: number | null;
	elapsedMs: number;
	stdout: string;
	stderr: string;
	rawJson: unknown;
	findings: ReturnType<typeof normalizeNuclei>;
	rawArtifact?: ArtifactSaveResult;
	stdoutArtifact?: ArtifactSaveResult;
	stderrArtifact?: ArtifactSaveResult;
	reasonCode?:
		| "tool_unavailable"
		| "invalid_structured_output"
		| "timed_out"
		| "execution_failed";
	error?: string;
	executionMetadata?: Record<string, unknown>;
};

function parseNucleiJsonl(value: string): unknown[] {
	return value
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

export class RuntimeScannerRunner {
	constructor(
		private readonly adapter: RuntimeScannerAdapter,
		private readonly storage: ArtifactStorage,
		private readonly execution?: ToolExecutionConfig,
	) {}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion("nuclei", ["-version"], {
			execution: this.execution,
			timeoutSec: 30,
		});
	}

	async run(params: {
		scanRunId: string;
		targetOrigin: string;
		timeoutSec?: number;
		templateRoot?: string;
		onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
	}): Promise<RuntimeScannerRunResult> {
		const startedAt = Date.now();
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), `${this.adapter}-run-`),
		);
		const outputPath = path.join(tempDir, "nuclei.jsonl");
		try {
			const args = buildNucleiSafeCommand(
				params.targetOrigin,
				outputPath,
				params.templateRoot ??
					process.env.VULN_WORKBENCH_NUCLEI_TEMPLATES ??
					"/opt/vuln-workbench/nuclei-safe-templates",
			);
			const toolResult = await runToolProcess("nuclei", args, {
				timeoutSec: params.timeoutSec,
				execution: this.execution,
				outputPath,
				onLifecycleEvent: params.onLifecycleEvent,
				env: {
					...getCleanEnv(),
					DISABLE_NUCLEI_TEMPLATES_PUBLIC_DOWNLOAD: "true",
				},
			});
			let rawJson: unknown;
			let structuredValid = false;
			try {
				rawJson = parseNucleiJsonl(await fs.readFile(outputPath, "utf8"));
				structuredValid = true;
			} catch {
				// A missing or malformed report is never a clean scan.
			}
			const artifacts: Partial<
				Pick<
					RuntimeScannerRunResult,
					"rawArtifact" | "stdoutArtifact" | "stderrArtifact"
				>
			> = {};
			if (structuredValid)
				artifacts.rawArtifact = await this.storage.saveRawArtifact(
					params.scanRunId,
					outputPath,
					"nuclei.jsonl",
				);
			if (toolResult.stdout)
				artifacts.stdoutArtifact = await this.storage.saveLog(
					params.scanRunId,
					"stdout",
					redactSecrets(toolResult.stdout),
				);
			if (toolResult.stderr)
				artifacts.stderrArtifact = await this.storage.saveLog(
					params.scanRunId,
					"stderr",
					redactSecrets(toolResult.stderr),
				);
			if (!toolResult.ok || toolResult.exitCode !== 0 || !structuredValid) {
				const reasonCode = toolResult.error?.includes("timed out")
					? "timed_out"
					: !structuredValid
						? "invalid_structured_output"
						: toolResult.error?.includes("not found")
							? "tool_unavailable"
							: "execution_failed";
				return {
					ok: false,
					exitCode: toolResult.exitCode,
					elapsedMs: Date.now() - startedAt,
					stdout: toolResult.stdout,
					stderr: toolResult.stderr,
					rawJson,
					findings: [],
					...artifacts,
					reasonCode,
					error:
						toolResult.error ??
						`nuclei exited with code ${toolResult.exitCode}`,
					executionMetadata: toolResult.executionMetadata,
				};
			}
			return {
				ok: true,
				exitCode: toolResult.exitCode,
				elapsedMs: Date.now() - startedAt,
				stdout: toolResult.stdout,
				stderr: toolResult.stderr,
				rawJson,
				findings: normalizeNuclei(rawJson),
				...artifacts,
				executionMetadata: toolResult.executionMetadata,
			};
		} finally {
			await cleanupTemporaryPaths([tempDir], "nuclei_workspace_cleanup_failed");
		}
	}
}
