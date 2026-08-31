import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalJson } from "../../../shared/canonical-json";
import {
	buildSchemathesisGraphqlReadonlyCommand,
	buildSchemathesisReadonlyCommand,
} from "../runtime-scans/command-contracts";
import type {
	ArtifactSaveResult,
	ArtifactStorage,
} from "../scans/artifact-storage";
import { cleanupTemporaryPaths } from "../scans/execution/lifecycle/temporary-path-cleanup";
import { readApiSchemaDocument } from "./api-schema-document";
import {
	buildGraphqlReadonlyOperationPolicy,
	type GraphqlReadonlyOperationPolicyV1,
	loadGraphqlReadonlyOperationPolicy,
	parseGraphqlReadonlySchema,
} from "./graphql-readonly-policy";
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
import { redactSecrets } from "../scans/normalizers/redaction";
import { readStrictJsonDocumentBytes } from "./strict-json-document";

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
	options: { includeAuthenticatedOperations?: boolean } = {},
) {
	const { bytes, document: schema } = await readApiSchemaDocument(
		schemaPath,
		snapshotRoot,
	);
	return buildOpenApiReadonlyOperationPolicy(
		parseOpenApiDocument(schema, options),
		sha256(bytes),
	);
}

export { loadGraphqlReadonlyOperationPolicy };

export type ApiReadonlyOperationPolicy =
	| OpenApiReadonlyOperationPolicyV1
	| GraphqlReadonlyOperationPolicyV1;

function isGraphqlOperationPolicy(
	policy: ApiReadonlyOperationPolicy,
): policy is GraphqlReadonlyOperationPolicyV1 {
	return "endpointPath" in policy;
}

export function operationPoliciesMatch(
	provided: ApiReadonlyOperationPolicy,
	derived: ApiReadonlyOperationPolicy,
): boolean {
	return (
		isGraphqlOperationPolicy(provided) === isGraphqlOperationPolicy(derived) &&
		canonicalJson(provided) === canonicalJson(derived)
	);
}

export function sanitizeSchemathesisOutput(
	value: string,
	sanitizeKnownValues?: (value: string) => string,
): string {
	return redactSecrets(sanitizeKnownValues?.(value) ?? value);
}

export function buildSchemathesisNamespaceGatewayPolicy(params: {
	targetOrigin: string;
	operationPolicy: ApiReadonlyOperationPolicy;
	upstreamRequestHeaders: Readonly<Record<string, string>>;
	maxRequests: number;
	rateLimitPerSec: number;
}) {
	const { operationPolicy } = params;
	const operations = isGraphqlOperationPolicy(operationPolicy)
		? [
				{
					method: "POST" as const,
					pathTemplate: operationPolicy.endpointPath,
				},
			]
		: operationPolicy.operations.map((operation) => ({
				method: operation.method,
				pathTemplate: `${operationPolicy.basePath === "/" ? "" : operationPolicy.basePath}${operation.pathTemplate}`,
			}));
	return {
		schemaVersion: 1 as const,
		upstreamOrigin: params.targetOrigin,
		operations,
		graphqlQueryOnly: isGraphqlOperationPolicy(operationPolicy),
		graphqlEndpointPath: isGraphqlOperationPolicy(operationPolicy)
			? operationPolicy.endpointPath
			: null,
		authHeaders: params.upstreamRequestHeaders,
		maxRequests: params.maxRequests,
		rateLimitPerSecond: params.rateLimitPerSec,
		requestTimeoutSeconds: 10,
		maxRequestBytes: isGraphqlOperationPolicy(operationPolicy)
			? operationPolicy.maxRequestBytes
			: 1_048_576,
		maxPathBytes: operationPolicy.maxPathBytes,
		maxPathSegmentBytes: operationPolicy.maxPathSegmentBytes,
		maxQueryParameters: operationPolicy.maxQueryParameters,
		maxQueryValueBytes: operationPolicy.maxQueryValueBytes,
		maxQueryBytes: operationPolicy.maxQueryBytes,
		maxRequestHeaderBytes: operationPolicy.maxRequestHeaderBytes,
		maxResponseBytes: operationPolicy.maxResponseBytes,
		maxTotalResponseBytes: operationPolicy.maxTotalResponseBytes,
	};
}

export function buildSchemathesisNamespaceGatewayInvocation(
	policyPath: string,
	command: string[],
) {
	return {
		binaryName: "vwb-schemathesis-readonly-gateway",
		args: ["run", policyPath, "--", ...command],
	};
}

export async function runSchemathesisReadonly(params: {
	scanRunId: string;
	schemaPath: string;
	repoPath?: string;
	targetOrigin: string;
	storage: ArtifactStorage;
	execution?: ToolExecutionConfig;
	timeoutSec?: number;
	schemaKind?: "openapi" | "graphql";
	operationPolicy?: ApiReadonlyOperationPolicy;
	namespaceGateway?: {
		upstreamRequestHeaders: Readonly<Record<string, string>>;
		maxRequests: number;
		rateLimitPerSec: number;
	};
	includeAuthenticatedOperations?: boolean;
	sanitizeOutput?: (value: string) => string;
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
	const schemaKind = params.schemaKind ?? "openapi";
	let derivedOperationPolicy: ApiReadonlyOperationPolicy;
	try {
		if (schemaKind === "graphql") {
			const schemaBytes = await readStrictJsonDocumentBytes(
				params.schemaPath,
				params.repoPath ?? path.dirname(params.schemaPath),
			);
			parseGraphqlReadonlySchema(schemaBytes);
			derivedOperationPolicy = buildGraphqlReadonlyOperationPolicy(
				sha256(schemaBytes),
			);
		} else {
			const loaded = await readApiSchemaDocument(
				params.schemaPath,
				params.repoPath ?? path.dirname(params.schemaPath),
			);
			const policy = evaluateApiReadonlyPolicy(loaded.document, {
				includeAuthenticatedOperations: params.includeAuthenticatedOperations,
			});
			if (!policy.ok) throw new Error(policy.reasonCode);
			derivedOperationPolicy = buildOpenApiReadonlyOperationPolicy(
				parseOpenApiDocument(loaded.document, {
					includeAuthenticatedOperations: params.includeAuthenticatedOperations,
				}),
				sha256(loaded.bytes),
			);
		}
	} catch (error) {
		return {
			ok: false,
			toolVersion: null,
			findings: [],
			exitCode: null,
			error:
				error instanceof Error
					? error.message.split(":")[0]
					: `${schemaKind}_schema_required`,
		};
	}
	if (
		params.operationPolicy &&
		!operationPoliciesMatch(params.operationPolicy, derivedOperationPolicy)
	)
		return {
			ok: false,
			toolVersion: null,
			findings: [],
			exitCode: null,
			error: `${schemaKind}_operation_policy_mismatch`,
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
	const policyDir = path.join(dir, "policy");
	const outputDir = path.join(dir, "output");
	await Promise.all([
		fs.mkdir(policyDir, { mode: 0o700 }),
		fs.mkdir(outputDir, { mode: 0o700 }),
	]);
	const outputPath = path.join(outputDir, "schemathesis.ndjson");
	try {
		const command = isGraphqlOperationPolicy(operationPolicy)
			? buildSchemathesisGraphqlReadonlyCommand(
					params.schemaPath,
					`${params.targetOrigin}${operationPolicy.endpointPath}`,
					outputPath,
				)
			: buildSchemathesisReadonlyCommand(
					params.schemaPath,
					params.targetOrigin,
					outputPath,
					operationPathRegex(operationPolicy),
				);
		let gatewayPolicyPath: string | undefined;
		if (params.namespaceGateway) {
			gatewayPolicyPath = path.join(policyDir, "readonly-gateway-policy.json");
			await fs.writeFile(
				gatewayPolicyPath,
				JSON.stringify(
					buildSchemathesisNamespaceGatewayPolicy({
						targetOrigin: params.targetOrigin,
						operationPolicy,
						...params.namespaceGateway,
					}),
				),
				// The 0700 parent protects the secret on the host. The bind-mounted
				// file itself must be readable by the fixed non-root container UID.
				{ encoding: "utf8", mode: 0o644 },
			);
		}
		const gatewayInvocation = gatewayPolicyPath
			? buildSchemathesisNamespaceGatewayInvocation(gatewayPolicyPath, command)
			: null;
		const result = await runToolProcess(
			gatewayInvocation?.binaryName ?? "st",
			gatewayInvocation?.args ?? command,
			{
				execution: params.execution,
				timeoutSec: params.timeoutSec,
				outputPath,
				repoPath: params.repoPath,
				inputPaths: [
					params.schemaPath,
					...(gatewayPolicyPath ? [gatewayPolicyPath] : []),
				],
			},
		);
		let raw: unknown = [];
		try {
			const sanitizedOutput = sanitizeSchemathesisOutput(
				await fs.readFile(outputPath, "utf8"),
				params.sanitizeOutput,
			);
			await fs.writeFile(outputPath, sanitizedOutput, "utf8");
			raw = sanitizedOutput
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
		const sanitizedStdout = sanitizeSchemathesisOutput(
			result.stdout,
			params.sanitizeOutput,
		);
		const sanitizedStderr = sanitizeSchemathesisOutput(
			result.stderr,
			params.sanitizeOutput,
		);
		const stdoutArtifact = sanitizedStdout
			? await params.storage.saveLog(
					params.scanRunId,
					"stdout",
					sanitizedStdout,
				)
			: undefined;
		const stderrArtifact = sanitizedStderr
			? await params.storage.saveLog(
					params.scanRunId,
					"stderr",
					sanitizedStderr,
				)
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
