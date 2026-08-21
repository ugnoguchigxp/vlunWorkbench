import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSchemathesisReadonlyCommand } from "../runtime-scans/command-contracts";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import {
	checkToolVersion,
	runToolProcess,
	type ToolExecutionConfig,
} from "../scans/tools/tool-process-runner";
import { cleanupTemporaryPaths } from "../scans/execution/lifecycle/temporary-path-cleanup";
import { normalizeSchemathesis } from "./schemathesis-normalizer";

export async function runSchemathesisReadonly(params: {
	scanRunId: string;
	schemaPath: string;
	repoPath?: string;
	targetOrigin: string;
	storage: ArtifactStorage;
	execution?: ToolExecutionConfig;
	timeoutSec?: number;
}): Promise<{
	ok: boolean;
	toolVersion: string | null;
	findings: ReturnType<typeof normalizeSchemathesis>;
	rawArtifact?: ArtifactSaveResult;
	stdoutArtifact?: ArtifactSaveResult;
	stderrArtifact?: ArtifactSaveResult;
	exitCode: number | null;
	error?: string;
}> {
	const version = await checkToolVersion("st", ["--version"], {
		execution: params.execution,
	});
	if (!version)
		return {
			ok: false,
			toolVersion: null,
			findings: [],
			exitCode: 127,
			error: "tool_unavailable",
		};
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "schemathesis-run-"));
	const outputPath = path.join(dir, "schemathesis.ndjson");
	try {
		const result = await runToolProcess(
			"st",
			buildSchemathesisReadonlyCommand(
				params.schemaPath,
				params.targetOrigin,
				outputPath,
			),
			{
				execution: params.execution,
				timeoutSec: params.timeoutSec,
				outputPath,
				repoPath: params.repoPath,
				inputPaths: [params.schemaPath],
			},
		);
		let raw: unknown = [];
		try {
			raw = (await fs.readFile(outputPath, "utf8"))
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
		} catch {
			return {
				ok: false,
				toolVersion: version,
				findings: [],
				exitCode: result.exitCode,
				error: "invalid_structured_output",
			};
		}
		const rawArtifact = await params.storage.saveRawArtifact(
			params.scanRunId,
			outputPath,
			"schemathesis.ndjson",
		);
		const stdoutArtifact = result.stdout
			? await params.storage.saveLog(params.scanRunId, "stdout", result.stdout)
			: undefined;
		const stderrArtifact = result.stderr
			? await params.storage.saveLog(params.scanRunId, "stderr", result.stderr)
			: undefined;
		return {
			ok: result.ok && (result.exitCode === 0 || result.exitCode === 1),
			toolVersion: version,
			findings: normalizeSchemathesis(raw),
			rawArtifact,
			stdoutArtifact,
			stderrArtifact,
			exitCode: result.exitCode,
			error: result.ok ? undefined : (result.error ?? "execution_failed"),
		};
	} finally {
		await cleanupTemporaryPaths([dir], "schemathesis_workspace_cleanup_failed");
	}
}
