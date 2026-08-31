import fs from "node:fs/promises";
import path from "node:path";
import type { AppDatabase } from "../../../db";
import type { SchemaDiscoveryResult } from "../../api-schema-fuzz/schema-discovery";
import {
	type ApiReadonlyOperationPolicy,
	loadGraphqlReadonlyOperationPolicy,
	loadOpenApiReadonlyOperationPolicy,
	runSchemathesisReadonly,
} from "../../api-schema-fuzz/schemathesis-runner";
import {
	type PreparedContainerTargetGateway,
	prepareContainerTargetGateway,
} from "../../dast/container-target-gateway";
import { apiAuthHeadersFor, redactSecretText } from "../../dast/auth-material";
import type { DastAuthContextRepository } from "../../dast/auth-context-repository";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "../repositories";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";
import { ScanArtifactSink } from "./lifecycle/artifact-sink";
import type { ArtifactStorage } from "./lifecycle/artifact-storage";

export async function runSchemaScannerIntoExistingScan(params: {
	db: AppDatabase;
	projectId: string;
	createdByUserId?: string;
	scanRunId: string;
	repoPath: string;
	targetOrigin: string;
	discovery: SchemaDiscoveryResult;
	artifactStorage: ArtifactStorage;
	timeoutSec?: number;
	execution?: ToolExecutionConfig;
	allowedPaths?: string[];
	excludedPaths?: string[];
	maxRequests?: number;
	rateLimitPerSec?: number;
	runtimeNamespaceOwnerId?: string;
	runtimeImage?: string;
	authContextRepository?: DastAuthContextRepository;
	authContextId?: string;
	identityRole?: string;
}): Promise<{
	applicable: boolean;
	reasonCode?: string;
	toolRunId: string | null;
	findingCount: number;
	artifactIds: string[];
	error?: string;
	metadata?: Record<string, unknown>;
}> {
	const discovery = params.discovery;
	if (Boolean(params.authContextId) !== Boolean(params.identityRole))
		throw new Error("api_auth_context_and_identity_role_required");
	if (params.authContextId && !params.authContextRepository)
		throw new Error("api_auth_context_repository_unavailable");
	if (!discovery.applicable || !discovery.schemaPath)
		return {
			applicable: false,
			reasonCode: discovery.reasonCode ?? "schema_not_found",
			toolRunId: null,
			findingCount: 0,
			artifactIds: [],
		};
	const scanRepo = new ScanRepository(params.db);
	const artifactRepo = new ArtifactRepository(params.db);
	const findingRepo = new FindingRepository(params.db);
	const toolRun = await scanRepo.createToolRun({
		scanRunId: params.scanRunId,
		toolName: "schemathesis",
		toolVersion: null,
		status: "running",
		command: "st run (readonly)",
		metadata: {
			schemaSource: discovery.source,
			schemaPath: discovery.schemaPath,
			auth: params.authContextId
				? {
						contextId: params.authContextId,
						identityRole: params.identityRole,
						mode: "gateway_injected",
					}
				: { mode: "anonymous" },
		},
	});
	const scopedStorage = params.artifactStorage.forToolRun(
		params.scanRunId,
		toolRun.id,
	);
	const artifactSink = new ScanArtifactSink(
		params.artifactStorage,
		artifactRepo,
		{ scanRunId: params.scanRunId, kind: "tool-run", id: toolRun.id },
	);
	const runtimeExecution: ToolExecutionConfig | undefined =
		params.runtimeNamespaceOwnerId
			? {
					...(params.execution ?? { runner: "docker" }),
					runner: "docker",
					docker: {
						...(params.execution?.docker ?? {}),
						runtimeNamespaceOwnerId: params.runtimeNamespaceOwnerId,
						...(params.runtimeImage ? { image: params.runtimeImage } : {}),
					},
				}
			: params.execution;
	let result: Awaited<ReturnType<typeof runSchemathesisReadonly>> | null = null;
	let operationPolicy: ApiReadonlyOperationPolicy | null = null;
	let gateway: PreparedContainerTargetGateway | null = null;
	let executionError: unknown = null;
	try {
		const schemaKind = discovery.schemaKind ?? "openapi";
		const snapshotRoot =
			discovery.source === "repository"
				? params.repoPath
				: path.dirname(discovery.schemaPath);
		const loadedOperationPolicy =
			schemaKind === "graphql"
				? await loadGraphqlReadonlyOperationPolicy(
						discovery.schemaPath,
						snapshotRoot,
					)
				: await loadOpenApiReadonlyOperationPolicy(
						discovery.schemaPath,
						snapshotRoot,
						{
							includeAuthenticatedOperations: Boolean(params.authContextId),
						},
					);
		operationPolicy = loadedOperationPolicy;
		const authMaterial = params.authContextId
			? await params.authContextRepository?.decryptForOriginUse({
					id: params.authContextId,
					projectId: params.projectId,
					targetOrigin: params.targetOrigin,
					identityRole: params.identityRole as string,
					actorUserId: params.createdByUserId,
				})
			: undefined;
		const upstreamRequestHeaders = apiAuthHeadersFor(authMaterial?.secret);
		if (!params.runtimeNamespaceOwnerId)
			gateway = await prepareContainerTargetGateway({
				upstreamOrigin: params.targetOrigin,
				allowedPaths: params.allowedPaths ?? ["/"],
				excludedPaths: params.excludedPaths ?? [],
				maxRequests: params.maxRequests ?? 30,
				rateLimitPerSec: params.rateLimitPerSec ?? 2,
				dockerBin: params.execution?.docker?.dockerBin,
				containerAccess: runtimeExecution?.runner === "docker",
				exactOperations:
					"endpointPath" in loadedOperationPolicy
						? [
								{
									method: "POST" as const,
									pathTemplate: loadedOperationPolicy.endpointPath,
								},
							]
						: loadedOperationPolicy.operations.map((operation) => ({
								method: operation.method,
								pathTemplate: `${loadedOperationPolicy.basePath === "/" ? "" : loadedOperationPolicy.basePath}${operation.pathTemplate}`,
							})),
				graphqlQueryOnly:
					"endpointPath" in loadedOperationPolicy
						? {
								pathTemplate: loadedOperationPolicy.endpointPath,
								maxRequestBytes: loadedOperationPolicy.maxRequestBytes,
							}
						: undefined,
				requestLimits: {
					maxPathBytes: loadedOperationPolicy.maxPathBytes,
					maxPathSegmentBytes: loadedOperationPolicy.maxPathSegmentBytes,
					maxQueryParameters: loadedOperationPolicy.maxQueryParameters,
					maxQueryValueBytes: loadedOperationPolicy.maxQueryValueBytes,
					maxQueryBytes: loadedOperationPolicy.maxQueryBytes,
					maxRequestHeaderBytes: loadedOperationPolicy.maxRequestHeaderBytes,
				},
				upstreamRequestHeaders,
			});
		result = await runSchemathesisReadonly({
			scanRunId: params.scanRunId,
			schemaPath: discovery.schemaPath,
			repoPath: params.runtimeNamespaceOwnerId
				? undefined
				: discovery.source === "repository"
					? params.repoPath
					: undefined,
			targetOrigin: params.runtimeNamespaceOwnerId
				? params.targetOrigin
				: runtimeExecution?.runner === "docker"
					? (gateway as PreparedContainerTargetGateway).containerOrigin
					: (gateway as PreparedContainerTargetGateway).hostOrigin,
			storage: scopedStorage,
			execution: runtimeExecution,
			timeoutSec: params.timeoutSec,
			schemaKind,
			operationPolicy: loadedOperationPolicy,
			includeAuthenticatedOperations: Boolean(authMaterial),
			sanitizeOutput: (value) => redactSecretText(value, authMaterial?.secret),
			namespaceGateway: params.runtimeNamespaceOwnerId
				? {
						upstreamRequestHeaders,
						maxRequests: params.maxRequests ?? 30,
						rateLimitPerSec: params.rateLimitPerSec ?? 2,
					}
				: undefined,
		});
	} catch (error) {
		executionError = error;
	} finally {
		const cleanupResults = await Promise.allSettled([
			...(gateway ? [gateway.stop()] : []),
			...(discovery.cleanupPath
				? [fs.rm(discovery.cleanupPath, { recursive: true, force: true })]
				: []),
		]);
		if (cleanupResults.some((cleanup) => cleanup.status === "rejected")) {
			executionError = new Error("api_schema_workspace_cleanup_failed");
		}
	}
	if (executionError || !result) {
		const message =
			executionError instanceof Error
				? executionError.message
				: "api_schema_execution_failed";
		try {
			await scanRepo.updateToolRunStatus(toolRun.id, "failed", {
				exitCode: 1,
				metadata: { error: message, reasonCode: "execution_failed" },
			});
		} catch {
			// The returned failure still prevents a successful parent profile.
		}
		return {
			applicable: true,
			toolRunId: toolRun.id,
			findingCount: 0,
			artifactIds: [],
			error: message,
		};
	}
	const artifactIds: string[] = [];
	const rawArtifactId = result.rawArtifact
		? (
				await artifactSink.registerSaved({
					role: "raw_result",
					format: "ndjson",
					saved: result.rawArtifact,
				})
			).id
		: null;
	if (rawArtifactId) artifactIds.push(rawArtifactId);
	if (result.stdoutArtifact)
		artifactIds.push(
			(
				await artifactSink.registerSaved({
					role: "stdout",
					format: "text",
					saved: result.stdoutArtifact,
				})
			).id,
		);
	if (result.stderrArtifact)
		artifactIds.push(
			(
				await artifactSink.registerSaved({
					role: "stderr",
					format: "text",
					saved: result.stderrArtifact,
				})
			).id,
		);
	if (!result.ok) {
		await scanRepo.updateToolRunStatus(toolRun.id, "failed", {
			exitCode: result.exitCode ?? 1,
			metadata: {
				toolVersion: result.toolVersion,
				error: result.error,
				artifactIds,
				gatewayMetrics: gateway?.metrics() ?? null,
				operationPolicyHash: operationPolicy?.policyHash ?? null,
				schemaSnapshotDigest: operationPolicy?.schemaSnapshotDigest ?? null,
			},
		});
		return {
			applicable: true,
			toolRunId: toolRun.id,
			findingCount: 0,
			artifactIds,
			error: result.error ?? "execution_failed",
			metadata: {
				gatewayMetrics: gateway?.metrics() ?? null,
				operationPolicyHash: operationPolicy?.policyHash ?? null,
			},
		};
	}
	for (const finding of result.findings) {
		const created = await findingRepo.createFinding({
			scanRunId: params.scanRunId,
			projectId: params.projectId,
			sourceTool: "schemathesis",
			ruleId: finding.ruleId,
			title: finding.title,
			description: finding.description,
			severity: finding.severity,
			confidence: finding.confidence,
			status: finding.status,
			primaryLocation: finding.primaryLocation,
			fingerprint: finding.fingerprint,
		});
		for (const evidence of finding.evidences)
			await findingRepo.createEvidence({
				findingId: created.id,
				kind: evidence.kind,
				title: evidence.title,
				artifactId: rawArtifactId,
				location: evidence.location,
				snippet: evidence.snippet,
			});
	}
	await scanRepo.updateToolRunStatus(toolRun.id, "completed", {
		exitCode: result.exitCode,
		metadata: {
			toolVersion: result.toolVersion,
			artifactIds,
			findingCount: result.findings.length,
			schemaSource: discovery.source,
			gatewayMetrics: gateway?.metrics() ?? null,
			operationPolicyHash: operationPolicy?.policyHash ?? null,
			schemaSnapshotDigest: operationPolicy?.schemaSnapshotDigest ?? null,
			selectedOperationCount:
				operationPolicy && "operations" in operationPolicy
					? operationPolicy.operations.length
					: operationPolicy
						? 1
						: 0,
		},
	});
	return {
		applicable: true,
		toolRunId: toolRun.id,
		findingCount: result.findings.length,
		artifactIds,
		metadata: {
			gatewayMetrics: gateway?.metrics() ?? null,
			operationPolicyHash: operationPolicy?.policyHash ?? null,
		},
	};
}
