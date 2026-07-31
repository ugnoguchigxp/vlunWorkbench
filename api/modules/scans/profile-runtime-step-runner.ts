import type { AppDatabase } from "../../db";
import {
	NUCLEI_SAFE_POLICY_HASH,
	NUCLEI_SAFE_POLICY_ID,
} from "../runtime-scans/command-contracts";
import {
	prepareContainerTargetGateway,
	type PreparedContainerTargetGateway,
} from "../dast/container-target-gateway";
import { RuntimeScannerRunner } from "../runtime-scans/runtime-scanner-runner";
import { ZapBaselineRunner } from "../runtime-scans/zap-baseline-runner";
import { ZAP_STABLE_IMAGE } from "../runtime-scans/zap-image-policy";
import type { ArtifactStorage } from "./artifact-storage";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "./repositories";
import type { ToolExecutionConfig } from "./tools/tool-process-runner";
import { normalizeToolExecutionConfig } from "./tools/tool-process-runner";
import { resolveScannerProvenance } from "./tools/scanner-provenance";

export async function runRuntimeScannerIntoExistingScan(params: {
	db: AppDatabase;
	projectId: string;
	scanRunId: string;
	adapter: "nuclei-safe" | "zap-baseline";
	targetOrigin: string;
	artifactStorage: ArtifactStorage;
	timeoutSec?: number;
	execution?: ToolExecutionConfig;
	allowedPaths?: string[];
	excludedPaths?: string[];
	maxRequests?: number;
	rateLimitPerSec?: number;
}): Promise<{
	toolRunId: string;
	findingCount: number;
	artifactIds: string[];
	exitCode: number | null;
	error?: string;
	reasonCode?: string;
	metadata?: Record<string, unknown>;
}> {
	const scanRepo = new ScanRepository(params.db);
	const artifactRepo = new ArtifactRepository(params.db);
	const findingRepo = new FindingRepository(params.db);
	const provenance = await resolveScannerProvenance({
		toolId: params.adapter,
		execution: normalizeToolExecutionConfig(params.execution),
	});
	const runner =
		params.adapter === "zap-baseline"
			? new ZapBaselineRunner(params.artifactStorage, params.execution)
			: new RuntimeScannerRunner(
					"nuclei-safe",
					params.artifactStorage,
					params.execution,
				);
	const toolVersion =
		params.adapter === "nuclei-safe"
			? await (runner as RuntimeScannerRunner).checkVersion()
			: null;
	const toolRun = await scanRepo.createToolRun({
		scanRunId: params.scanRunId,
		toolName: params.adapter,
		toolVersion,
		status: "running",
		command: params.adapter,
		metadata: {
			adapter: params.adapter,
			targetOrigin: params.targetOrigin,
			policyId:
				params.adapter === "nuclei-safe"
					? NUCLEI_SAFE_POLICY_ID
					: "zap-baseline-passive-v1",
			policyHash:
				params.adapter === "nuclei-safe" ? NUCLEI_SAFE_POLICY_HASH : null,
			image: params.adapter === "zap-baseline" ? ZAP_STABLE_IMAGE : null,
			provenance,
		},
	});
	if (params.adapter === "nuclei-safe" && !toolVersion) {
		await scanRepo.updateToolRunStatus(toolRun.id, "failed", {
			exitCode: 127,
			metadata: { reasonCode: "tool_unavailable", provenance },
		});
		return {
			toolRunId: toolRun.id,
			findingCount: 0,
			artifactIds: [],
			exitCode: 127,
			error: "nuclei executable not found",
			reasonCode: "tool_unavailable",
		};
	}
	let nucleiGateway: PreparedContainerTargetGateway | null = null;
	let result:
		| Awaited<ReturnType<RuntimeScannerRunner["run"]>>
		| Awaited<ReturnType<ZapBaselineRunner["run"]>>;
	try {
		if (params.adapter === "nuclei-safe") {
			nucleiGateway = await prepareContainerTargetGateway({
				upstreamOrigin: params.targetOrigin,
				allowedPaths: params.allowedPaths ?? ["/"],
				excludedPaths: params.excludedPaths ?? [],
				maxRequests: params.maxRequests ?? 20,
				rateLimitPerSec: params.rateLimitPerSec ?? 2,
				dockerBin: params.execution?.docker?.dockerBin,
				containerAccess: params.execution?.runner === "docker",
			});
		}
		result =
			params.adapter === "zap-baseline"
				? await (runner as ZapBaselineRunner).run({
						scanRunId: params.scanRunId,
						upstreamOrigin: params.targetOrigin,
						allowedPaths: params.allowedPaths ?? ["/"],
						excludedPaths: params.excludedPaths ?? [],
						maxRequests: params.maxRequests ?? 20,
						rateLimitPerSec: params.rateLimitPerSec ?? 2,
						timeoutSec: params.timeoutSec,
					})
				: await (runner as RuntimeScannerRunner).run({
						scanRunId: params.scanRunId,
						targetOrigin:
							params.execution?.runner === "docker"
								? (nucleiGateway as PreparedContainerTargetGateway)
										.containerOrigin
								: (nucleiGateway as PreparedContainerTargetGateway).hostOrigin,
						timeoutSec: params.timeoutSec,
					});
		if (params.adapter === "nuclei-safe") {
			result.executionMetadata = {
				...(result.executionMetadata ?? {}),
				gatewayMetrics: nucleiGateway?.metrics() ?? null,
			};
		}
	} finally {
		await nucleiGateway?.stop().catch(() => undefined);
	}
	const artifactIds: string[] = [];
	const rawArtifactId = result.rawArtifact
		? (
				await artifactRepo.createArtifact({
					scanRunId: params.scanRunId,
					toolRunId: toolRun.id,
					kind: "raw_result",
					format: params.adapter === "nuclei-safe" ? "jsonl" : "json",
					path: result.rawArtifact.path,
					sha256: result.rawArtifact.sha256,
					sizeBytes: result.rawArtifact.sizeBytes,
				})
			).id
		: null;
	if (rawArtifactId) artifactIds.push(rawArtifactId);
	const stderrArtifactId = result.stderrArtifact
		? (
				await artifactRepo.createArtifact({
					scanRunId: params.scanRunId,
					toolRunId: toolRun.id,
					kind: "stderr",
					format: "text",
					path: result.stderrArtifact.path,
					sha256: result.stderrArtifact.sha256,
					sizeBytes: result.stderrArtifact.sizeBytes,
				})
			).id
		: null;
	if (stderrArtifactId) artifactIds.push(stderrArtifactId);
	if (result.stdoutArtifact)
		artifactIds.push(
			(
				await artifactRepo.createArtifact({
					scanRunId: params.scanRunId,
					toolRunId: toolRun.id,
					kind: "stdout",
					format: "text",
					path: result.stdoutArtifact.path,
					sha256: result.stdoutArtifact.sha256,
					sizeBytes: result.stdoutArtifact.sizeBytes,
				})
			).id,
		);
	if (!result.ok) {
		await scanRepo.updateToolRunStatus(toolRun.id, "failed", {
			exitCode: result.exitCode ?? 1,
			metadata: {
				...result.executionMetadata,
				provenance,
				reasonCode: result.reasonCode,
				error: result.error,
				artifactIds,
			},
		});
		return {
			toolRunId: toolRun.id,
			findingCount: 0,
			artifactIds,
			exitCode: result.exitCode,
			error: result.error,
			reasonCode: result.reasonCode,
			metadata: result.executionMetadata,
		};
	}
	let findingCount = 0;
	for (const finding of result.findings) {
		const created = await findingRepo.createFinding({
			scanRunId: params.scanRunId,
			projectId: params.projectId,
			sourceTool: params.adapter,
			ruleId: finding.ruleId,
			title: finding.title,
			description: finding.description,
			severity: finding.severity,
			confidence: finding.confidence,
			status: finding.status,
			primaryLocation: finding.primaryLocation,
			fingerprint: finding.fingerprint,
			metadata: finding.metadata,
		});
		findingCount++;
		for (const evidence of finding.evidences)
			await findingRepo.createEvidence({
				findingId: created.id,
				kind: evidence.kind,
				title: evidence.title,
				artifactId:
					evidence.kind === "scan-log" ? stderrArtifactId : rawArtifactId,
				location: evidence.location,
				snippet: evidence.snippet,
			});
	}
	await scanRepo.updateToolRunStatus(toolRun.id, "completed", {
		exitCode: result.exitCode,
		toolVersion:
			typeof result.executionMetadata?.reportVersion === "string"
				? result.executionMetadata.reportVersion
				: null,
		metadata: {
			...result.executionMetadata,
			provenance,
			adapter: params.adapter,
			targetOrigin: params.targetOrigin,
			findingCount,
			artifactIds,
			elapsedMs: result.elapsedMs,
		},
	});
	return {
		toolRunId: toolRun.id,
		findingCount,
		artifactIds,
		exitCode: result.exitCode,
		metadata: result.executionMetadata,
	};
}
