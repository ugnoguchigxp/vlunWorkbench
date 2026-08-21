import fs from "node:fs/promises";
import type { AppDatabase } from "../../../db";
import type { SchemaDiscoveryResult } from "../../api-schema-fuzz/schema-discovery";
import { runSchemathesisReadonly } from "../../api-schema-fuzz/schemathesis-runner";
import {
	type PreparedContainerTargetGateway,
	prepareContainerTargetGateway,
} from "../../dast/container-target-gateway";
import { ScanArtifactSink } from "./lifecycle/artifact-sink";
import type { ArtifactStorage } from "./lifecycle/artifact-storage";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "../repositories";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";

export async function runSchemaScannerIntoExistingScan(params: {
	db: AppDatabase;
	projectId: string;
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
	let gateway: PreparedContainerTargetGateway | null = null;
	let executionError: unknown = null;
	try {
		if (!params.runtimeNamespaceOwnerId)
			gateway = await prepareContainerTargetGateway({
				upstreamOrigin: params.targetOrigin,
				allowedPaths: params.allowedPaths ?? ["/"],
				excludedPaths: params.excludedPaths ?? [],
				maxRequests: params.maxRequests ?? 30,
				rateLimitPerSec: params.rateLimitPerSec ?? 2,
				dockerBin: params.execution?.docker?.dockerBin,
				containerAccess: runtimeExecution?.runner === "docker",
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
			},
		});
		return {
			applicable: true,
			toolRunId: toolRun.id,
			findingCount: 0,
			artifactIds,
			error: result.error ?? "execution_failed",
			metadata: { gatewayMetrics: gateway?.metrics() ?? null },
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
		},
	});
	return {
		applicable: true,
		toolRunId: toolRun.id,
		findingCount: result.findings.length,
		artifactIds,
		metadata: { gatewayMetrics: gateway?.metrics() ?? null },
	};
}
