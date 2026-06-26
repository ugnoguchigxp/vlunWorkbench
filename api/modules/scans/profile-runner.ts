import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import type { AppDatabase } from "../../db";
import { ArtifactStorage } from "./artifact-storage";
import { normalizeGitleaks } from "./normalizers/gitleaks";
import { normalizeOsv } from "./normalizers/osv";
// Import normalizers
import { normalizeSemgrep } from "./normalizers/semgrep";
import { normalizeTrivy } from "./normalizers/trivy";
import { getProfileById } from "./profiles";
import { buildMarkdownReport } from "./report-builder";
import { ScanReportRepository } from "./report-repository";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "./repositories";
import { resolveScanScope, withMandatoryExcludes } from "./target-scope";
import { GitleaksRunner } from "./tools/gitleaks-runner";
import { OsvRunner } from "./tools/osv-runner";
// Import runners
import { SemgrepRunner } from "./tools/semgrep-runner";
import {
	normalizeToolExecutionConfig,
	type ToolExecutionConfig,
	type ToolLifecycleEvent,
} from "./tools/tool-process-runner";
import { TrivyRunner } from "./tools/trivy-runner";

export interface ToolResult {
	toolId: string;
	toolRunId: string | null;
	required: boolean;
	status: "completed" | "failed" | "skipped";
	findingCount: number;
	exitCode: number | null;
	error: string | null;
}

export interface ProfileScanResult {
	ok: boolean;
	scanRunId: string;
	profileId: string;
	status: "completed" | "failed";
	profileOutcome: "completed" | "completed_with_warnings" | "failed";
	runner: "host" | "docker";
	message?: string;
	toolResults: ToolResult[];
	finalReport?: FinalReportResult;
}

export interface FinalReportOptions {
	enabled: boolean;
	title?: string;
	includeFalsePositives?: boolean;
	includeDeferred?: boolean;
	includeUndecided?: boolean;
}

export interface FinalReportResult {
	ok: boolean;
	reportId: string | null;
	artifactId: string | null;
	artifactPath: string | null;
	status: "completed" | "failed" | "skipped";
	error: string | null;
}

function buildBaseExecutionMetadata(execution: ToolExecutionConfig) {
	if (execution.runner === "docker") {
		const docker = execution.docker ?? {};
		return {
			runner: "docker",
			docker: {
				image: docker.image ?? "vuln-workbench-toolbox:local",
				networkMode: docker.networkMode ?? "none",
				mountMode: {
					repo: "read-only",
					output: "read-write",
					cache: docker.toolCacheDir ? "read-write" : "none",
				},
				resourceLimits: {
					memory: docker.memory ?? null,
					cpus: docker.cpus ?? null,
				},
			},
		};
	}
	return { runner: "host" };
}

async function generateFinalReport(params: {
	db: AppDatabase;
	scanRunId: string;
	artifactStorage: ArtifactStorage;
	options: Required<FinalReportOptions>;
}): Promise<FinalReportResult> {
	const reportRepo = new ScanReportRepository(params.db);
	const artifactRepo = new ArtifactRepository(params.db);
	const report = await reportRepo.createReport({
		scanRunId: params.scanRunId,
		format: "markdown",
		title: params.options.title,
		options: {
			includeFalsePositives: params.options.includeFalsePositives,
			includeDeferred: params.options.includeDeferred,
			includeUndecided: params.options.includeUndecided,
			source: "scan-profile-final-report",
		},
		status: "running",
	});

	try {
		const markdown = await buildMarkdownReport(params.db, params.scanRunId, {
			includeFalsePositives: params.options.includeFalsePositives,
			includeDeferred: params.options.includeDeferred,
			includeUndecided: params.options.includeUndecided,
			title: params.options.title,
		});
		const filename = `report-${report.id}.md`;
		const saveResult = await params.artifactStorage.saveTextArtifact(
			params.scanRunId,
			"reports",
			markdown,
			filename,
		);
		const artifact = await artifactRepo.createArtifact({
			scanRunId: params.scanRunId,
			toolRunId: null,
			kind: "report",
			format: "markdown",
			path: saveResult.path,
			sha256: saveResult.sha256,
			sizeBytes: saveResult.sizeBytes,
			metadata: { reportId: report.id, source: "scan-profile-final-report" },
		});
		await reportRepo.updateReportStatus(report.id, "completed", {
			artifactId: artifact.id,
			summary: markdown.slice(0, 500),
		});
		return {
			ok: true,
			reportId: report.id,
			artifactId: artifact.id,
			artifactPath: saveResult.path,
			status: "completed",
			error: null,
		};
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		await reportRepo.updateReportStatus(report.id, "failed", {
			errorMessage: error,
		});
		return {
			ok: false,
			reportId: report.id,
			artifactId: null,
			artifactPath: null,
			status: "failed",
			error,
		};
	}
}

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
}): Promise<{
	toolRunId: string;
	findingCount: number;
	exitCode: number | null;
	elapsedMs: number;
	artifactIds: string[];
}> {
	const scanRepo = new ScanRepository(params.db);
	const artifactRepo = new ArtifactRepository(params.db);
	const findingRepo = new FindingRepository(params.db);

	const options = params.options ?? {};
	const timeoutSec = params.timeoutSec;
	const execution = normalizeToolExecutionConfig(params.execution);
	const baseExecutionMetadata = buildBaseExecutionMetadata(execution);
	const scope = options.scope as ScanScopePolicy | undefined;
	const scanners = Array.isArray(options.scanners)
		? (options.scanners as string[])
		: undefined;
	const dependencyMode = options.dependencyMode as
		| "manifest"
		| "installed_tree"
		| undefined;

	// 1. Resolve Runner & Normalizer
	let runner: SemgrepRunner | GitleaksRunner | OsvRunner | TrivyRunner;
	let normalizer: (rawJson: unknown, opts?: { stderr?: string }) => any[];
	let toolName: string;
	let defaultCommand: string;

	switch (params.toolId) {
		case "semgrep":
			runner = new SemgrepRunner(params.artifactStorage, execution);
			normalizer = normalizeSemgrep;
			toolName = "semgrep";
			defaultCommand = `semgrep scan --config ${options.config ?? "auto"}`;
			break;
		case "gitleaks":
			runner = new GitleaksRunner(params.artifactStorage, execution);
			normalizer = normalizeGitleaks;
			toolName = "gitleaks";
			defaultCommand = "gitleaks detect";
			break;
		case "osv":
			runner = new OsvRunner(params.artifactStorage, execution);
			normalizer = normalizeOsv;
			toolName = "osv";
			defaultCommand = "osv-scanner";
			break;
		case "trivy":
			runner = new TrivyRunner(params.artifactStorage, execution);
			normalizer = normalizeTrivy;
			toolName = "trivy";
			defaultCommand = "trivy fs";
			break;
		default:
			throw new Error(`Unsupported tool ID: ${params.toolId}`);
	}

	// 2. Check Version
	const toolVersion = await runner.checkVersion();

	// 3. Create Tool Run in running status
	const toolRun = await scanRepo.createToolRun({
		scanRunId: params.scanRunId,
		toolName,
		toolVersion,
		status: "running",
		command: defaultCommand,
		metadata: baseExecutionMetadata,
	});
	const toolRunId = toolRun.id;

	if (!toolVersion) {
		const errMsg = `${toolName} executable not found on host system`;
		await params.db.transaction(async (tx) => {
			const txScanRepo = new ScanRepository(tx);
			await txScanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "error",
				eventType: "tool.failed",
				message: `${toolName} failed: ${errMsg}`,
				data: { toolRunId },
			});
			await txScanRepo.updateToolRunStatus(toolRunId, "failed", {
				exitCode: 127,
				metadata: {
					adapter: toolName,
					...baseExecutionMetadata,
					error: errMsg,
					options,
					timeoutSec: timeoutSec ?? null,
					toolVersion,
				},
			});
		});
		throw new Error(errMsg);
	}

	let exitCode: number | null = null;
	let findingCount = 0;
	let evidenceCount = 0;
	const artifactIds: string[] = [];
	let executionMetadata = baseExecutionMetadata;

	try {
		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "tool.started",
			message: `${params.toolId} scan started`,
			data: { toolRunId },
		});

		// 4. Execute Runner
		let runResult: any;
		const onLifecycleEvent = async (event: ToolLifecycleEvent) => {
			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				...event,
			});
		};
		if (params.toolId === "semgrep") {
			runResult = await (runner as SemgrepRunner).run(
				params.scanRunId,
				params.repoPath,
				{
					config: (options.config as string) ?? "auto",
					scope,
					timeoutSec,
					maxTargetBytes: options.maxTargetBytes
						? Number(options.maxTargetBytes)
						: undefined,
					onLifecycleEvent,
				},
			);
		} else if (params.toolId === "gitleaks") {
			runResult = await (runner as GitleaksRunner).run(
				params.scanRunId,
				params.repoPath,
				{
					timeoutSec,
					scope,
					onLifecycleEvent,
				},
			);
		} else if (params.toolId === "osv") {
			runResult = await (runner as OsvRunner).run(
				params.scanRunId,
				params.repoPath,
				{
					timeoutSec,
					scope,
					dependencyMode,
					onLifecycleEvent,
				},
			);
		} else {
			runResult = await (runner as TrivyRunner).run(
				params.scanRunId,
				params.repoPath,
				{
					timeoutSec,
					scope,
					scanners,
					onLifecycleEvent,
				},
			);
		}

		exitCode = runResult.exitCode;
		executionMetadata = runResult.executionMetadata ?? baseExecutionMetadata;

		// 5. Register Artifacts
		let rawArtifactId: string | null = null;
		let stderrArtifactId: string | null = null;

		if (runResult.rawJsonArtifact) {
			const rawRecord = await artifactRepo.createArtifact({
				scanRunId: params.scanRunId,
				toolRunId,
				kind: "raw_result",
				format: "json",
				path: runResult.rawJsonArtifact.path,
				sha256: runResult.rawJsonArtifact.sha256,
				sizeBytes: runResult.rawJsonArtifact.sizeBytes,
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
			const stdoutRecord = await artifactRepo.createArtifact({
				scanRunId: params.scanRunId,
				toolRunId,
				kind: "stdout",
				format: "text",
				path: runResult.stdoutArtifact.path,
				sha256: runResult.stdoutArtifact.sha256,
				sizeBytes: runResult.stdoutArtifact.sizeBytes,
			});
			artifactIds.push(stdoutRecord.id);
		}

		if (runResult.stderrArtifact) {
			const stderrRecord = await artifactRepo.createArtifact({
				scanRunId: params.scanRunId,
				toolRunId,
				kind: "stderr",
				format: "text",
				path: runResult.stderrArtifact.path,
				sha256: runResult.stderrArtifact.sha256,
				sizeBytes: runResult.stderrArtifact.sizeBytes,
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

		const normalizedFindings = normalizer(runResult.rawJson, {
			stderr: runResult.stderr,
		});

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
				metadata: (nf as any).metadata,
			});
			findingCount++;

			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "info",
				eventType: "finding.created",
				message: `Finding created: ${nf.title} (${nf.ruleId})`,
				data: { findingId: finding.id },
			});

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
		};
	} catch (err: any) {
		// Log error event
		try {
			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "error",
				eventType: "tool.failed",
				message: `${params.toolId} failed: ${err.message}`,
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
					options,
					timeoutSec: timeoutSec ?? null,
					toolVersion,
					error: err.message,
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

export async function runProfileScan(params: {
	db: AppDatabase;
	projectId: string;
	profileId: string;
	repoPath: string;
	continueOnToolFailure?: boolean;
	timeoutSec?: number;
	createdByUserId?: string | null;
	execution?: ToolExecutionConfig;
	finalReport?: FinalReportOptions;
}): Promise<ProfileScanResult> {
	const scanRepo = new ScanRepository(params.db);
	const artifactStorage = new ArtifactStorage();
	const execution = normalizeToolExecutionConfig(params.execution);

	const profile = getProfileById(params.profileId);
	if (!profile) {
		throw new Error(`Profile not found: ${params.profileId}`);
	}
	const finalReportOptions: Required<FinalReportOptions> = {
		enabled: params.finalReport?.enabled ?? false,
		title:
			params.finalReport?.title ??
			`${profile.name || params.profileId} 最終セキュリティレポート`,
		includeFalsePositives: params.finalReport?.includeFalsePositives ?? true,
		includeDeferred: params.finalReport?.includeDeferred ?? true,
		includeUndecided: params.finalReport?.includeUndecided ?? true,
	};
	const resolvedScope = await resolveScanScope({
		repoPath: params.repoPath,
		scope: profile.scope,
	});

	const continueOnToolFailure = params.continueOnToolFailure ?? true;

	// 1. Create Scan Run in running state
	const scanRun = await scanRepo.createScanRun({
		projectId: params.projectId,
		profile: params.profileId,
		status: "running",
		createdByUserId: params.createdByUserId,
		metadata: {
			profileId: params.profileId,
			profileVersion: 1,
			scope: resolvedScope,
			continueOnToolFailure,
			runner: execution.runner,
			toolOrder: profile.tools.map((t) => t.toolId),
			toolResults: [],
		},
	});

	await scanRepo.createScanEvent({
		scanRunId: scanRun.id,
		level: "info",
		eventType: "scan.started",
		message: `Scan profile ${params.profileId} started.`,
	});

	const toolResults: ToolResult[] = [];
	let profileFailingToolFailed = false;
	let optionalToolFailed = false;

	for (const tool of profile.tools) {
		const resolvedTimeout =
			tool.timeoutSec ?? params.timeoutSec ?? profile.defaultTimeoutSec;
		const failureFailsProfile =
			tool.required || tool.failurePolicy === "fail_profile";

		let toolRunId: string | null = null;
		let findingCount = 0;
		let exitCode: number | null = null;
		let status: "completed" | "failed" | "skipped" = "completed";
		let error: string | null = null;

		// Check if we should skip due to earlier profile-failing tool failure.
		if (profileFailingToolFailed && !continueOnToolFailure) {
			status = "skipped";
			toolResults.push({
				toolId: tool.toolId,
				toolRunId: null,
				required: tool.required,
				status,
				findingCount: 0,
				exitCode: null,
				error: "Skipped due to previous profile-failing tool failure",
			});
			continue;
		}

		try {
			const toolRes = await runToolIntoExistingScan({
				db: params.db,
				projectId: params.projectId,
				scanRunId: scanRun.id,
				toolId: tool.toolId,
				options: {
					...(tool.options ?? {}),
					scope: withMandatoryExcludes(profile.scope),
					scopeSummary: resolvedScope,
				},
				artifactStorage,
				timeoutSec: resolvedTimeout,
				repoPath: params.repoPath,
				execution,
			});

			toolRunId = toolRes.toolRunId;
			findingCount = toolRes.findingCount;
			exitCode = toolRes.exitCode;
			status = "completed";
		} catch (err: any) {
			status = "failed";
			error = err.message;

			if (failureFailsProfile) {
				profileFailingToolFailed = true;
			} else {
				optionalToolFailed = true;
			}
		}

		toolResults.push({
			toolId: tool.toolId,
			toolRunId,
			required: tool.required,
			status,
			findingCount,
			exitCode,
			error,
		});
	}

	// Determine profile outcome
	let profileOutcome: "completed" | "completed_with_warnings" | "failed" =
		"completed";
	let finalScanStatus: "completed" | "failed" = "completed";

	if (profileFailingToolFailed) {
		// A fail_profile tool failed, so the overall outcome is failed.
		profileOutcome = "failed";
		finalScanStatus = "failed";
	} else if (optionalToolFailed) {
		// required tools succeeded, but at least one optional tool failed
		profileOutcome = "completed_with_warnings";
		finalScanStatus = "completed";
	} else {
		// all succeeded
		profileOutcome = "completed";
		finalScanStatus = "completed";
	}

	// Update Scan Run status
	const totalFindings = toolResults.reduce((acc, r) => acc + r.findingCount, 0);
	const summaryMsg =
		profileOutcome === "failed"
			? `Scan profile ${params.profileId} failed due to profile-failing tool failure.`
			: `Scan profile ${params.profileId} completed with outcome: ${profileOutcome}. Found ${totalFindings} findings total.`;

	await scanRepo.updateScanRunStatus(scanRun.id, finalScanStatus, {
		summary: summaryMsg,
		metadata: {
			profileId: params.profileId,
			profileVersion: 1,
			scope: resolvedScope,
			profileOutcome,
			continueOnToolFailure,
			runner: execution.runner,
			toolOrder: profile.tools.map((t) => t.toolId),
			toolResults,
		},
	});

	await scanRepo.createScanEvent({
		scanRunId: scanRun.id,
		level: profileOutcome === "failed" ? "error" : "info",
		eventType: profileOutcome === "failed" ? "scan.failed" : "scan.completed",
		message: summaryMsg,
	});

	let finalReport: FinalReportResult | undefined;
	if (finalReportOptions.enabled) {
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "report.started",
			message: "Final scan report generation started.",
		});
		finalReport = await generateFinalReport({
			db: params.db,
			scanRunId: scanRun.id,
			artifactStorage,
			options: finalReportOptions,
		});
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: finalReport.ok ? "info" : "error",
			eventType: finalReport.ok ? "report.completed" : "report.failed",
			message: finalReport.ok
				? `Final scan report generated: ${finalReport.artifactPath}`
				: `Final scan report generation failed: ${finalReport.error}`,
			data: { ...finalReport },
		});
	}

	const ok = profileOutcome !== "failed" && (finalReport?.ok ?? true);
	const message =
		finalReport && !finalReport.ok
			? `${summaryMsg} Final report generation failed: ${finalReport.error}`
			: summaryMsg;

	return {
		ok,
		scanRunId: scanRun.id,
		profileId: params.profileId,
		status: finalScanStatus,
		profileOutcome,
		runner: execution.runner,
		message,
		toolResults,
		finalReport,
	};
}
