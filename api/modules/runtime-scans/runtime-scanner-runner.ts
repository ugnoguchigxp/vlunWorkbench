import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import {
	redactJsonSecrets,
	redactSecrets,
} from "../scans/normalizers/redaction";
import {
	checkToolVersion,
	getCleanEnv,
	runToolProcess,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "../scans/tools/tool-process-runner";
import {
	buildNucleiSafeCommand,
	buildZapBaselineCommand,
} from "./command-contracts";
import { normalizeNuclei } from "./nuclei-normalizer";
import { normalizeZap } from "./zap-normalizer";

export type RuntimeScannerAdapter = "nuclei-safe" | "zap-baseline";
export const ZAP_STABLE_IMAGE =
	"zaproxy/zap-stable:sha256-1110082c94217b6e9592b18934740108839a44c02f1d0e961e4933bbb98bab45";

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
		| "target_unreachable_from_container"
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

	private binary(): string {
		return this.adapter === "nuclei-safe" ? "nuclei" : "zap-baseline.py";
	}

	private executionConfig(): ToolExecutionConfig | undefined {
		if (this.execution?.runner !== "docker") return this.execution;
		return {
			...this.execution,
			docker: {
				...this.execution.docker,
				image:
					this.adapter === "zap-baseline"
						? ZAP_STABLE_IMAGE
						: this.execution.docker?.image,
				networkMode: "default",
			},
		};
	}

	async checkVersion(): Promise<string | null> {
		return await checkToolVersion(
			this.binary(),
			this.adapter === "nuclei-safe" ? ["-version"] : ["-h"],
			{ execution: this.executionConfig(), timeoutSec: 30 },
		);
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
		const outputPath = path.join(
			tempDir,
			this.adapter === "nuclei-safe" ? "nuclei.jsonl" : "zap-report.json",
		);
		const targetOrigin =
			this.execution?.runner === "docker"
				? params.targetOrigin.replace("127.0.0.1", "host.docker.internal")
				: params.targetOrigin;
		const args =
			this.adapter === "nuclei-safe"
				? buildNucleiSafeCommand(
						targetOrigin,
						outputPath,
						params.templateRoot ??
							process.env.VULN_WORKBENCH_NUCLEI_TEMPLATES ??
							"/opt/vuln-workbench/nuclei-safe-templates",
					)
				: buildZapBaselineCommand(targetOrigin, outputPath);
		const toolResult = await runToolProcess(this.binary(), args, {
			timeoutSec: params.timeoutSec,
			execution: this.executionConfig(),
			outputPath,
			onLifecycleEvent: params.onLifecycleEvent,
			env:
				this.adapter === "nuclei-safe"
					? {
							...getCleanEnv(),
							DISABLE_NUCLEI_TEMPLATES_PUBLIC_DOWNLOAD: "true",
						}
					: undefined,
		});
		const elapsedMs = Date.now() - startedAt;
		let rawJson: unknown;
		let structuredValid = false;
		try {
			const output = await fs.readFile(outputPath, "utf8");
			rawJson =
				this.adapter === "nuclei-safe"
					? parseNucleiJsonl(output)
					: JSON.parse(output);
			structuredValid = true;
		} catch {
			// Missing/truncated output is an execution failure, never a clean scan.
		}
		const artifactResults: Partial<
			Pick<
				RuntimeScannerRunResult,
				"rawArtifact" | "stdoutArtifact" | "stderrArtifact"
			>
		> = {};
		if (structuredValid) {
			artifactResults.rawArtifact = await this.storage.saveRawArtifact(
				params.scanRunId,
				outputPath,
				path.basename(outputPath),
			);
		}
		if (toolResult.stdout)
			artifactResults.stdoutArtifact = await this.storage.saveLog(
				params.scanRunId,
				"stdout",
				redactSecrets(toolResult.stdout),
			);
		if (toolResult.stderr)
			artifactResults.stderrArtifact = await this.storage.saveLog(
				params.scanRunId,
				"stderr",
				redactSecrets(toolResult.stderr),
			);
		await fs
			.rm(tempDir, { recursive: true, force: true })
			.catch(() => undefined);
		const acceptableExit =
			this.adapter === "zap-baseline"
				? [0, 1, 2].includes(toolResult.exitCode ?? -1)
				: toolResult.exitCode === 0;
		if (!toolResult.ok || !acceptableExit || !structuredValid) {
			const reasonCode =
				this.execution?.runner === "docker" &&
				/target|connect|reach/i.test(toolResult.error ?? "")
					? "target_unreachable_from_container"
					: toolResult.error?.includes("timed out")
						? "timed_out"
						: !structuredValid
							? "invalid_structured_output"
							: toolResult.error?.includes("not found")
								? "tool_unavailable"
								: "execution_failed";
			return {
				ok: false,
				exitCode: toolResult.exitCode,
				elapsedMs,
				stdout: toolResult.stdout,
				stderr: toolResult.stderr,
				rawJson,
				findings: [],
				...artifactResults,
				reasonCode,
				error:
					toolResult.error ??
					`${this.adapter} exited with code ${toolResult.exitCode}`,
				executionMetadata: toolResult.executionMetadata,
			};
		}
		const findings =
			this.adapter === "nuclei-safe"
				? normalizeNuclei(rawJson)
				: normalizeZap(rawJson);
		return {
			ok: true,
			exitCode: toolResult.exitCode,
			elapsedMs,
			stdout: toolResult.stdout,
			stderr: toolResult.stderr,
			rawJson: redactJsonSecrets(rawJson),
			findings,
			...artifactResults,
			executionMetadata: toolResult.executionMetadata,
		};
	}
}
