import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSchemathesisReadonlyCommand } from "../runtime-scans/command-contracts";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import { cleanupTemporaryPaths } from "../scans/execution/lifecycle/temporary-path-cleanup";
import {
	checkToolVersion,
	runToolProcess,
	type ToolExecutionConfig,
} from "../scans/tools/tool-process-runner";
import { evaluateApiReadonlyPolicy } from "./api-readonly-policy";
import { parseOpenApiDocument } from "./openapi-document";
import {
	buildOpenApiReadonlyOperationPolicy,
	type OpenApiReadonlyOperationPolicyV1,
} from "./openapi-readonly-operation-policy";
import { normalizeSchemathesis } from "./schemathesis-normalizer";
import {
	parseStrictJsonDocument,
	readStrictJsonDocumentBytes,
} from "./strict-json-document";

const sha256 = (value: Uint8Array) =>
	`sha256:${createHash("sha256").update(value).digest("hex")}`;

function operationPathRegex(
	policy: ReturnType<typeof buildOpenApiReadonlyOperationPolicy>,
) {
	const escapeRegex = (value: string) =>
		value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const paths = policy.operations.map((operation) => {
		const fullPath = `${policy.basePath === "/" ? "" : policy.basePath}${operation.pathTemplate}`;
		return escapeRegex(fullPath).replace(/\\\{[^{}]+\\\}/g, "[^/]+");
	});
	return `^(?:${[...new Set(paths)].sort().join("|")})$`;
}

export async function loadOpenApiReadonlyOperationPolicy(
	schemaPath: string,
	snapshotRoot: string,
) {
	const bytes = await readStrictJsonDocumentBytes(schemaPath, snapshotRoot);
	const schema = parseStrictJsonDocument(bytes);
	return buildOpenApiReadonlyOperationPolicy(
		parseOpenApiDocument(schema),
		sha256(bytes),
	);
}

export async function runSchemathesisReadonly(params: {
	scanRunId: string;
	schemaPath: string;
	repoPath?: string;
	targetOrigin: string;
	storage: ArtifactStorage;
	execution?: ToolExecutionConfig;
	timeoutSec?: number;
	operationPolicy?: OpenApiReadonlyOperationPolicyV1;
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
	let schema: unknown;
	let schemaBytes: Uint8Array;
	try {
		schemaBytes = await readStrictJsonDocumentBytes(
			params.schemaPath,
			params.repoPath ?? path.dirname(params.schemaPath),
		);
		schema = parseStrictJsonDocument(schemaBytes);
	} catch {
		return {
			ok: false,
			toolVersion: null,
			findings: [],
			exitCode: null,
			error: "openapi_schema_required",
		};
	}
	const policy = evaluateApiReadonlyPolicy(schema);
	if (!policy.ok) {
		return {
			ok: false,
			toolVersion: null,
			findings: [],
			exitCode: null,
			error: policy.reasonCode,
		};
	}
	const parsedDocument = parseOpenApiDocument(schema);
	const derivedOperationPolicy = buildOpenApiReadonlyOperationPolicy(
		parsedDocument,
		sha256(schemaBytes),
	);
	if (
		params.operationPolicy &&
		params.operationPolicy.policyHash !== derivedOperationPolicy.policyHash
	)
		return {
			ok: false,
			toolVersion: null,
			findings: [],
			exitCode: null,
			error: "openapi_operation_policy_mismatch",
		};
	const operationPolicy = params.operationPolicy ?? derivedOperationPolicy;
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
				operationPathRegex(operationPolicy),
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
