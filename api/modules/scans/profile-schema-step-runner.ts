import fs from "node:fs/promises";
import type { AppDatabase } from "../../db";
import { discoverApiSchema } from "../api-schema-fuzz/schema-discovery";
import { runSchemathesisReadonly } from "../api-schema-fuzz/schemathesis-runner";
import type { ArtifactStorage } from "./artifact-storage";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "./repositories";
import type { ToolExecutionConfig } from "./tools/tool-process-runner";

export async function runSchemaScannerIntoExistingScan(params: {
	db: AppDatabase;
	projectId: string;
	scanRunId: string;
	repoPath: string;
	targetOrigin: string;
	artifactStorage: ArtifactStorage;
	timeoutSec?: number;
	execution?: ToolExecutionConfig;
}): Promise<{
	applicable: boolean;
	reasonCode?: string;
	toolRunId: string | null;
	findingCount: number;
	artifactIds: string[];
	error?: string;
}> {
	const discovery = await discoverApiSchema({
		repoPath: params.repoPath,
		targetOrigin: params.targetOrigin,
	});
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
	let result: Awaited<ReturnType<typeof runSchemathesisReadonly>>;
	try {
		result = await runSchemathesisReadonly({
			scanRunId: params.scanRunId,
			schemaPath: discovery.schemaPath,
			repoPath: discovery.source === "repository" ? params.repoPath : undefined,
			targetOrigin: params.targetOrigin,
			storage: params.artifactStorage,
			execution: params.execution,
			timeoutSec: params.timeoutSec,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await scanRepo.updateToolRunStatus(toolRun.id, "failed", {
			exitCode: 1,
			metadata: { error: message, reasonCode: "execution_failed" },
		});
		return {
			applicable: true,
			toolRunId: toolRun.id,
			findingCount: 0,
			artifactIds: [],
			error: message,
		};
	} finally {
		if (discovery.cleanupPath)
			await fs.rm(discovery.cleanupPath, { recursive: true, force: true });
	}
	const artifactIds: string[] = [];
	const rawArtifactId = result.rawArtifact
		? (
				await artifactRepo.createArtifact({
					scanRunId: params.scanRunId,
					toolRunId: toolRun.id,
					kind: "raw_result",
					format: "ndjson",
					path: result.rawArtifact.path,
					sha256: result.rawArtifact.sha256,
					sizeBytes: result.rawArtifact.sizeBytes,
				})
			).id
		: null;
	if (rawArtifactId) artifactIds.push(rawArtifactId);
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
	if (result.stderrArtifact)
		artifactIds.push(
			(
				await artifactRepo.createArtifact({
					scanRunId: params.scanRunId,
					toolRunId: toolRun.id,
					kind: "stderr",
					format: "text",
					path: result.stderrArtifact.path,
					sha256: result.stderrArtifact.sha256,
					sizeBytes: result.stderrArtifact.sizeBytes,
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
			},
		});
		return {
			applicable: true,
			toolRunId: toolRun.id,
			findingCount: 0,
			artifactIds,
			error: result.error ?? "execution_failed",
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
		},
	});
	return {
		applicable: true,
		toolRunId: toolRun.id,
		findingCount: result.findings.length,
		artifactIds,
	};
}
