import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import type { AppDatabase } from "../../db";
import { ScanArtifactSink } from "./artifact-sink";
import type { ArtifactStorage } from "./artifact-storage";
import {
	buildBaseExecutionMetadata,
	buildDiffFindingRelation,
	type CommonToolRunResult,
	type DiffToolExecutionContext,
	persistedTargetMetadata,
} from "./profile-runner";
import { selectStaticTool } from "./profile-static-tool-selection";
import { prepareToolProvenance } from "./profile-tool-provenance";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "./repositories";
import {
	normalizeToolExecutionConfig,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tools/tool-process-runner";

export async function runToolIntoExistingScan(params: {
	db: AppDatabase;
	projectId: string;
	scanRunId: string;
	toolId: string;
	options?: Record<string, unknown>;
	artifactStorage: ArtifactStorage;
	timeoutSec?: number;
	repoPath: string;
	execution?: ToolExecutionConfig;
	diffContext?: DiffToolExecutionContext;
}): Promise<{
	toolRunId: string;
	findingCount: number;
	exitCode: number | null;
	elapsedMs: number;
	artifactIds: string[];
	diffUnmappedFindingCount: number;
}> {
	const scanRepo = new ScanRepository(params.db);
	const artifactRepo = new ArtifactRepository(params.db);
	const findingRepo = new FindingRepository(params.db);

	let options = { ...(params.options ?? {}) };
	const timeoutSec = params.timeoutSec;
	const execution = normalizeToolExecutionConfig(params.execution);
	const selectedTool = selectStaticTool({
		toolId: params.toolId,
		artifactStorage: params.artifactStorage,
		execution,
		options,
	});
	await selectedTool.adapter.validateOptions?.(options);
	const preparedProvenance = await prepareToolProvenance({
		toolId: params.toolId,
		execution,
		options,
		adapter: selectedTool.adapter,
	});
	options = preparedProvenance.options;
	const scannerProvenance = preparedProvenance.provenance;
	const baseExecutionMetadata = buildBaseExecutionMetadata(execution);
	const diffExecutionMetadata = params.diffContext
		? {
				scanTarget: persistedTargetMetadata(params.diffContext.target),
				diffInputKind: params.diffContext.inputKind,
				diffChangedFileCount: params.diffContext.entries.filter(
					(entry) => entry.disposition === "scan",
				).length,
				diffContextFileCount: params.diffContext.contextFileCount ?? 0,
			}
		: {};
	const scope = options.scope as ScanScopePolicy | undefined;
	const { runner: versionRunner, normalizer, toolName } = selectedTool;
	const defaultCommand = selectedTool.adapter.defaultCommand(options);

	// 2. Check Version
	const toolVersion = await versionRunner.checkVersion();

	// 3. Create Tool Run in running status
	const toolRun = await scanRepo.createToolRun({
		scanRunId: params.scanRunId,
		toolName,
		toolVersion,
		status: "running",
		command: defaultCommand,
		metadata: {
			...baseExecutionMetadata,
			...diffExecutionMetadata,
			provenance: scannerProvenance,
		},
	});
	const toolRunId = toolRun.id;
	// Every invocation gets its own immutable artifact namespace. The initial
	// runner above is used only for the version probe, before a tool-run ID exists.
	const runner = selectedTool.adapter.createRunner({
		artifactStorage: params.artifactStorage.forToolRun(
			params.scanRunId,
			toolRunId,
		),
		execution,
	});
	const artifactSink = new ScanArtifactSink(
		params.artifactStorage,
		artifactRepo,
		{
			scanRunId: params.scanRunId,
			kind: "tool-run",
			id: toolRunId,
		},
	);

	if (!toolVersion) {
		const errMsg = `${toolName} executable not found on host system`;
		await scanRepo.recordToolUnavailable({
			scanRunId: params.scanRunId,
			toolRunId,
			toolName,
			message: errMsg,
			metadata: {
				adapter: toolName,
				...baseExecutionMetadata,
				...diffExecutionMetadata,
				error: errMsg,
				options,
				timeoutSec: timeoutSec ?? null,
				toolVersion,
			},
		});
		throw new Error(errMsg);
	}

	let exitCode: number | null = null;
	let findingCount = 0;
	let evidenceCount = 0;
	let diffUnmappedFindingCount = 0;
	const artifactIds: string[] = [];
	let executionMetadata: Record<string, unknown> = {
		...baseExecutionMetadata,
		...diffExecutionMetadata,
		provenance: scannerProvenance,
	};

	try {
		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "tool.started",
			message: `${params.toolId} scan started`,
			data: { toolRunId },
		});

		// 4. Execute Runner
		let runResult: CommonToolRunResult;
		const onLifecycleEvent = async (event: ToolLifecycleEvent) => {
			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				...event,
			});
		};
		runResult = await runner.run({
			scanRunId: params.scanRunId,
			repoPath: params.repoPath,
			options,
			timeoutSec,
			scope,
			diffContext: params.diffContext,
			onLifecycleEvent,
		});

		exitCode = runResult.exitCode;
		executionMetadata = {
			...baseExecutionMetadata,
			...diffExecutionMetadata,
			provenance: scannerProvenance,
			...(runResult.executionMetadata ?? {}),
		};

		// 5. Register Artifacts
		let rawArtifactId: string | null = null;
		let stderrArtifactId: string | null = null;

		if (runResult.rawJsonArtifact) {
			const rawRecord = await artifactSink.registerSaved({
				role: options.mode === "fs-sbom" ? "sbom" : "raw_result",
				format: options.mode === "fs-sbom" ? "cyclonedx-json" : "json",
				saved: runResult.rawJsonArtifact,
				metadata:
					options.mode === "fs-sbom"
						? { inventory: true, findingConversion: "disabled" }
						: undefined,
			});
			rawArtifactId = rawRecord.id;
			artifactIds.push(rawRecord.id);

			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "info",
				eventType: "artifact.registered",
				message: `Raw JSON artifact registered: ${runResult.rawJsonArtifact.path}`,
				data: { artifactId: rawRecord.id },
			});
		}

		if (runResult.stdoutArtifact) {
			const stdoutRecord = await artifactSink.registerSaved({
				role: "stdout",
				format: "text",
				saved: runResult.stdoutArtifact,
			});
			artifactIds.push(stdoutRecord.id);
		}

		if (runResult.stderrArtifact) {
			const stderrRecord = await artifactSink.registerSaved({
				role: "stderr",
				format: "text",
				saved: runResult.stderrArtifact,
			});
			stderrArtifactId = stderrRecord.id;
			artifactIds.push(stderrRecord.id);
		}

		// Check if run completed successfully
		if (!runResult.ok) {
			throw new Error(
				runResult.error ||
					`${toolName} run failed with exit code ${runResult.exitCode}`,
			);
		}

		// 6. Normalize & Parse Results
		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "artifact.parse_started",
			message: `Parsing ${toolName} raw output.`,
		});

		const normalizedFindings =
			options.mode === "fs-sbom"
				? []
				: normalizer(runResult.rawJson, { stderr: runResult.stderr });

		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "artifact.parse_completed",
			message: `Successfully parsed ${normalizedFindings.length} findings from ${toolName} output.`,
		});

		// 7. Insert Findings & Evidence
		const processedFingerprints = new Set<string>();

		for (const nf of normalizedFindings) {
			if (processedFingerprints.has(nf.fingerprint)) {
				continue;
			}
			processedFingerprints.add(nf.fingerprint);
			const diffRelation = params.diffContext
				? buildDiffFindingRelation(
						nf,
						params.toolId,
						params.diffContext.entries,
					)
				: null;

			const finding = await findingRepo.createFinding({
				scanRunId: params.scanRunId,
				projectId: params.projectId,
				sourceTool: toolName,
				ruleId: nf.ruleId,
				title: nf.title,
				description: nf.description,
				severity: nf.severity,
				confidence: nf.confidence,
				status: nf.status,
				primaryLocation: nf.primaryLocation,
				fingerprint: nf.fingerprint,
				metadata: {
					...(nf.metadata ?? {}),
					...(params.diffContext
						? {
								scanTarget: persistedTargetMetadata(params.diffContext.target),
								diffRelation,
							}
						: {}),
				},
			});
			findingCount++;

			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "info",
				eventType: "finding.created",
				message: `Finding created: ${nf.title} (${nf.ruleId})`,
				data: { findingId: finding.id },
			});
			if (diffRelation?.kind === "unmapped") {
				diffUnmappedFindingCount++;
				await scanRepo.createScanEvent({
					scanRunId: params.scanRunId,
					level: "warn",
					eventType: "finding.diff_unmapped",
					message: `Finding path could not be mapped to the diff manifest: ${nf.primaryLocation.path}`,
					data: {
						findingId: finding.id,
						toolId: params.toolId,
						path: nf.primaryLocation.path,
						targetDigest: params.diffContext?.target.targetDigest,
					},
				});
			}

			for (const ev of nf.evidences) {
				const associatedArtifactId =
					ev.kind === "scan-log" ? stderrArtifactId : rawArtifactId;

				await findingRepo.createEvidence({
					findingId: finding.id,
					kind: ev.kind,
					title: ev.title,
					artifactId: associatedArtifactId,
					location: ev.location,
					snippet: ev.snippet,
				});
				evidenceCount++;
			}
		}

		// 8. Update run status to completed
		await scanRepo.updateToolRunStatus(toolRunId, "completed", {
			exitCode: runResult.exitCode,
			metadata: {
				adapter: toolName,
				...executionMetadata,
				elapsedMs: runResult.elapsedMs,
				artifactIds,
				findingCount,
				evidenceCount,
				diffUnmappedFindingCount,
				options,
				timeoutSec: timeoutSec ?? null,
				toolVersion,
			},
		});

		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "tool.completed",
			message: `${params.toolId} completed successfully. Found ${findingCount} findings.`,
			data: { toolRunId },
		});

		return {
			toolRunId,
			findingCount,
			exitCode: runResult.exitCode,
			elapsedMs: runResult.elapsedMs,
			artifactIds,
			diffUnmappedFindingCount,
		};
	} catch (err: unknown) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		// Log error event
		try {
			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "error",
				eventType: "tool.failed",
				message: `${params.toolId} failed: ${errorMessage}`,
				data: { toolRunId },
			});
			await scanRepo.updateToolRunStatus(toolRunId, "failed", {
				exitCode: exitCode ?? 1,
				metadata: {
					adapter: toolName,
					...executionMetadata,
					artifactIds,
					findingCount,
					evidenceCount,
					diffUnmappedFindingCount,
					options,
					timeoutSec: timeoutSec ?? null,
					toolVersion,
					error: errorMessage,
				},
			});
		} catch (innerErr) {
			console.error(
				`Failed to write failure events/status for ${toolName}:`,
				innerErr,
			);
		}
		throw err;
	}
}
