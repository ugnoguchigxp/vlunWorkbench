import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	ArtifactStorage,
	type ArtifactSaveResult,
} from "../modules/scans/artifact-storage";
import {
	executionConfigFromPolicy,
	resolveScanExecutionPolicy,
	scanExecutionPolicyMetadata,
} from "../modules/scans/scan-execution-policy";
import {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";
import type { ToolExecutionConfig } from "../modules/scans/tools/tool-process-runner";
import { runCliAutomatedDiagnostic } from "./scan-profile-diagnostic";

export interface ScannerCliRunResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	rawJson?: unknown;
	rawJsonArtifact?: ArtifactSaveResult;
	stdoutArtifact?: ArtifactSaveResult;
	stderrArtifact?: ArtifactSaveResult;
	error?: string;
}

export interface ScannerCliFinding {
	ruleId: string;
	title: string;
	description: string;
	severity: string;
	confidence: string;
	status: string;
	primaryLocation: Record<string, unknown> | null;
	fingerprint: string;
	evidences: Array<{
		kind: string;
		title: string;
		location: Record<string, unknown> | null;
		snippet?: string | null;
	}>;
	metadata?: Record<string, unknown>;
}

interface ScannerCliRunner {
	checkVersion(): Promise<string | null>;
}

export interface ScannerCliAdapter<TOptions, TRunner extends ScannerCliRunner> {
	adapter: string;
	displayName: string;
	command: string;
	unavailableMessage: string;
	createRunner: (
		storage: ArtifactStorage,
		execution: ToolExecutionConfig,
	) => TRunner;
	run: (
		runner: TRunner,
		scanRunId: string,
		repoPath: string,
		options: TOptions,
	) => Promise<ScannerCliRunResult>;
	normalize: (rawJson: unknown, stderr: string) => ScannerCliFinding[];
	runMetadata?: (options: TOptions) => Record<string, unknown>;
}

export interface ScannerCliRequest<TOptions> {
	projectId: string;
	profile: string;
	options: TOptions;
}

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function registerArtifact(
	artifactRepo: ArtifactRepository,
	params: {
		scanRunId: string;
		toolRunId: string;
		kind: "raw_result" | "stdout" | "stderr";
		format: "json" | "text";
		artifact?: ArtifactSaveResult;
	},
): Promise<string | null> {
	if (!params.artifact) return null;
	const record = await artifactRepo.createArtifact({
		scanRunId: params.scanRunId,
		toolRunId: params.toolRunId,
		kind: params.kind,
		format: params.format,
		path: params.artifact.path,
		sha256: params.artifact.sha256,
		sizeBytes: params.artifact.sizeBytes,
	});
	return record.id;
}

export async function executeScannerCli<
	TOptions,
	TRunner extends ScannerCliRunner,
>(
	adapter: ScannerCliAdapter<TOptions, TRunner>,
	request: ScannerCliRequest<TOptions>,
): Promise<void> {
	const env = readAppEnv();
	const executionPolicy = resolveScanExecutionPolicy({ env, surface: "cli" });
	const execution = executionConfigFromPolicy(executionPolicy);
	const connection = createDbConnection(env.databaseUrl);
	const projectRepo = new ProjectRepository(connection.db);
	const scanRepo = new ScanRepository(connection.db);
	const artifactRepo = new ArtifactRepository(connection.db);
	const findingRepo = new FindingRepository(connection.db);
	const runner = adapter.createRunner(new ArtifactStorage(), execution);

	try {
		const project = await projectRepo.findById(request.projectId);
		if (!project) {
			writeResult({
				ok: false,
				status: "failed",
				message: `Project not found with id: ${request.projectId}`,
			});
			process.exitCode = 1;
			return;
		}

		const toolVersion = await runner.checkVersion();
		if (!toolVersion) {
			writeResult({
				ok: false,
				status: "failed",
				message: adapter.unavailableMessage,
			});
			process.exitCode = 1;
			return;
		}

		let scanRun: Awaited<ReturnType<ScanRepository["createScanRun"]>>;
		try {
			scanRun = await scanRepo.createScanRun({
				projectId: request.projectId,
				profile: request.profile,
				status: "running",
				metadata: {
					executionPolicy: scanExecutionPolicyMetadata(executionPolicy),
					automaticDiagnosticRequested: true,
				},
			});
		} catch (error) {
			writeResult({
				ok: false,
				status: "failed",
				message: `Failed to create scan run: ${errorMessage(error)}`,
			});
			process.exitCode = 1;
			return;
		}

		const artifactIds: string[] = [];
		let toolRunId: string | null = null;
		let toolExitCode: number | null = null;
		let findingCount = 0;
		let evidenceCount = 0;
		const adapterMetadata = adapter.runMetadata?.(request.options) ?? {};

		try {
			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "info",
				eventType: "scan.started",
				message: `${adapter.displayName} scan started for project: ${project.name}`,
			});
			const toolRun = await scanRepo.createToolRun({
				scanRunId: scanRun.id,
				toolName: adapter.adapter,
				toolVersion,
				status: "running",
				command: adapter.command,
			});
			toolRunId = toolRun.id;

			const runResult = await adapter.run(
				runner,
				scanRun.id,
				project.repoPath,
				request.options,
			);
			toolExitCode = runResult.exitCode;

			const rawArtifactId = await registerArtifact(artifactRepo, {
				scanRunId: scanRun.id,
				toolRunId,
				kind: "raw_result",
				format: "json",
				artifact: runResult.rawJsonArtifact,
			});
			if (rawArtifactId) {
				artifactIds.push(rawArtifactId);
				await scanRepo.createScanEvent({
					scanRunId: scanRun.id,
					level: "info",
					eventType: "artifact.registered",
					message: `Raw JSON artifact registered: ${runResult.rawJsonArtifact?.path}`,
					data: { artifactId: rawArtifactId },
				});
			}
			const stdoutArtifactId = await registerArtifact(artifactRepo, {
				scanRunId: scanRun.id,
				toolRunId,
				kind: "stdout",
				format: "text",
				artifact: runResult.stdoutArtifact,
			});
			if (stdoutArtifactId) artifactIds.push(stdoutArtifactId);
			const stderrArtifactId = await registerArtifact(artifactRepo, {
				scanRunId: scanRun.id,
				toolRunId,
				kind: "stderr",
				format: "text",
				artifact: runResult.stderrArtifact,
			});
			if (stderrArtifactId) artifactIds.push(stderrArtifactId);

			if (!runResult.ok) {
				throw new Error(
					runResult.error ??
						`${adapter.displayName} run failed with exit code ${runResult.exitCode}`,
				);
			}

			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "info",
				eventType: "artifact.parse_started",
				message: `Parsing ${adapter.displayName} raw output.`,
			});
			const normalizedFindings = adapter.normalize(
				runResult.rawJson,
				runResult.stderr,
			);
			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "info",
				eventType: "artifact.parse_completed",
				message: `Successfully parsed ${normalizedFindings.length} findings from ${adapter.displayName} output.`,
			});

			const processedFingerprints = new Set<string>();
			for (const normalized of normalizedFindings) {
				if (processedFingerprints.has(normalized.fingerprint)) continue;
				processedFingerprints.add(normalized.fingerprint);
				const finding = await findingRepo.createFinding({
					scanRunId: scanRun.id,
					projectId: request.projectId,
					sourceTool: adapter.adapter,
					ruleId: normalized.ruleId,
					title: normalized.title,
					description: normalized.description,
					severity: normalized.severity,
					confidence: normalized.confidence,
					status: normalized.status,
					primaryLocation: normalized.primaryLocation,
					fingerprint: normalized.fingerprint,
					metadata: normalized.metadata,
				});
				findingCount++;
				await scanRepo.createScanEvent({
					scanRunId: scanRun.id,
					level: "info",
					eventType: "finding.created",
					message: `Finding created: ${normalized.title} (${normalized.ruleId})`,
					data: { findingId: finding.id },
				});
				for (const evidence of normalized.evidences) {
					await findingRepo.createEvidence({
						findingId: finding.id,
						kind: evidence.kind,
						title: evidence.title,
						artifactId:
							evidence.kind === "scan-log" ? stderrArtifactId : rawArtifactId,
						location: evidence.location,
						snippet: evidence.snippet,
					});
					evidenceCount++;
				}
			}

			const runMetadata = {
				adapter: adapter.adapter,
				elapsedMs: runResult.elapsedMs,
				artifactIds,
				findingCount,
				evidenceCount,
				...adapterMetadata,
			};
			await scanRepo.updateToolRunStatus(toolRunId, "completed", {
				exitCode: runResult.exitCode,
				metadata: runMetadata,
			});
			await scanRepo.updateScanRunStatus(scanRun.id, "completed", {
				summary: `${adapter.displayName} scan completed successfully. Found ${findingCount} findings.`,
			});
			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "info",
				eventType: "scan.completed",
				message: "Scan run completed successfully.",
			});
			const diagnostic = await runDiagnosticSafely({
				db: connection.db,
				env,
				scanRunId: scanRun.id,
			});
			writeResult({
				ok: true,
				scanRunId: scanRun.id,
				toolRunId,
				artifactIds,
				findingCount,
				evidenceCount,
				status: "completed",
				diagnostic,
			});
		} catch (error) {
			const message = errorMessage(error);
			try {
				await scanRepo.createScanEvent({
					scanRunId: scanRun.id,
					level: "error",
					eventType: "scan.failed",
					message: `Scan failed: ${message}`,
				});
				if (toolRunId) {
					await scanRepo.updateToolRunStatus(toolRunId, "failed", {
						exitCode: toolExitCode ?? 1,
						metadata: {
							adapter: adapter.adapter,
							artifactIds,
							findingCount,
							evidenceCount,
							...adapterMetadata,
							error: message,
						},
					});
				}
				await scanRepo.updateScanRunStatus(scanRun.id, "failed");
			} catch (statusError) {
				console.error(
					"Failed to write failure events/status to DB:",
					statusError,
				);
			}
			writeResult({
				ok: false,
				scanRunId: scanRun.id,
				status: "failed",
				message,
			});
			process.exitCode = 1;
		}
	} catch (error) {
		writeResult({
			ok: false,
			status: "failed",
			message: errorMessage(error),
		});
		process.exitCode = 1;
	} finally {
		connection.sqlite.close(false);
	}
}

async function runDiagnosticSafely(
	params: Parameters<typeof runCliAutomatedDiagnostic>[0],
) {
	try {
		return await runCliAutomatedDiagnostic(params);
	} catch (error) {
		return {
			status: "failed",
			readiness: "failed",
			error:
				error instanceof Error ? error.message : "Automated diagnostic failed.",
		};
	}
}
