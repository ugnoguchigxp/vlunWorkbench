import fs from "node:fs/promises";
import type {
	DastProfileStep,
	ProfileToolEntry,
	ScanProfileStep,
	ScanScopePolicy,
} from "../../../shared/schemas/scan-profile.schema";
import type { AppDatabase } from "../../db";
import { discoverApiSchema } from "../api-schema-fuzz/schema-discovery";
import { runSchemathesisReadonly } from "../api-schema-fuzz/schemathesis-runner";
import { DastRepository } from "../dast/dast-repository";
import { DastRunner } from "../dast/dast-runner";
import { prepareDastTargetWorkspace } from "../dast/target-preparer";
import {
	NUCLEI_SAFE_POLICY_HASH,
	NUCLEI_SAFE_POLICY_ID,
} from "../runtime-scans/command-contracts";
import { RuntimeScannerRunner } from "../runtime-scans/runtime-scanner-runner";
import { ZapBaselineRunner } from "../runtime-scans/zap-baseline-runner";
import { ZAP_STABLE_IMAGE } from "../runtime-scans/zap-image-policy";
import type { ArtifactStorage } from "./artifact-storage";
import type { NormalizedFinding } from "./normalizers/fixture";
import { normalizeGitleaks } from "./normalizers/gitleaks";
import { normalizeOsv } from "./normalizers/osv";
// Import normalizers
import { normalizeSemgrep } from "./normalizers/semgrep";
import { normalizeTrivy } from "./normalizers/trivy";
import { buildMarkdownReport } from "./report-builder";
import { ScanReportRepository } from "./report-repository";
import {
	ArtifactRepository,
	FindingRepository,
	ScanRepository,
} from "./repositories";
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

export type DastStepResult = {
	kind: "dast";
	profileId: string;
	required: boolean;
	status: "completed" | "failed" | "skipped";
	outcome: string | null;
	findingCount: number;
	dastRunId: string | null;
	targetOrigin: string | null;
	error: string | null;
	autoTarget?: {
		scriptName: string;
		command: string[];
		port: number;
		origin: string;
		warnings: string[];
	};
};

export type CoverageStepResult = {
	kind:
		| "runtime_scanner"
		| "sbom_export"
		| "api_schema_scan"
		| "container_image_scan";
	stepId: string;
	adapter: string;
	required: boolean;
	status: "completed" | "failed" | "skipped";
	applicability: "applicable" | "not_applicable";
	reasonCode: string | null;
	coverageEffect: "covered" | "partial" | "gap";
	findingCount: number;
	error: string | null;
	artifactIds?: string[];
	metadata?: Record<string, unknown>;
};

export type ScanProfileStepResult =
	| (ToolResult & { kind: "static_tool" })
	| DastStepResult
	| CoverageStepResult;

export interface ProfileScanResult {
	ok: boolean;
	scanRunId: string;
	profileId: string;
	status: "completed" | "failed";
	profileOutcome: "completed" | "completed_with_warnings" | "failed";
	runner: "host" | "docker";
	message?: string;
	toolResults: ToolResult[];
	stepResults: ScanProfileStepResult[];
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

type CommonToolRunResult = {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	rawJson?: unknown;
	rawJsonArtifact?: {
		path: string;
		sha256: string;
		sizeBytes: number;
	};
	stdoutArtifact?: { path: string; sha256: string; sizeBytes: number };
	stderrArtifact?: { path: string; sha256: string; sizeBytes: number };
	error?: string;
	executionMetadata?: Record<string, unknown>;
};

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

export function resolveProfileSteps(params: {
	steps?: ScanProfileStep[];
	tools: ProfileToolEntry[];
	stepId?: string;
}): ScanProfileStep[] {
	const steps =
		params.steps ??
		params.tools.map((tool) => ({
			kind: "static_tool" as const,
			...tool,
		}));
	if (!params.stepId) return steps;
	const selected = steps.filter((step) => {
		const id =
			step.kind === "static_tool"
				? step.toolId
				: step.kind === "dast"
					? `dast:${step.profileId}`
					: `${step.kind}:${step.adapter}`;
		return id === params.stepId;
	});
	if (selected.length === 0)
		throw new Error(`Profile step not found: ${params.stepId}`);
	return selected;
}

export async function generateFinalReport(params: {
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
	if (
		params.toolId === "trivy" &&
		options.mode === "image" &&
		!options.imageRef &&
		!options.imageTar
	) {
		throw new Error("image_input_not_provided");
	}
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
	let normalizer: (
		rawJson: unknown,
		opts?: { stderr?: string },
	) => NormalizedFinding[];
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
		await scanRepo.recordToolUnavailable({
			scanRunId: params.scanRunId,
			toolRunId,
			toolName,
			message: errMsg,
			metadata: {
				adapter: toolName,
				...baseExecutionMetadata,
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
	const artifactIds: string[] = [];
	let executionMetadata: Record<string, unknown> = baseExecutionMetadata;

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
					mode: options.mode as
						| "fs-vulnerability"
						| "fs-sbom"
						| "image"
						| undefined,
					imageRef: options.imageRef as string | undefined,
					imageTar: options.imageTar as string | undefined,
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
				kind: options.mode === "fs-sbom" ? "sbom" : "raw_result",
				format: options.mode === "fs-sbom" ? "cyclonedx-json" : "json",
				path: runResult.rawJsonArtifact.path,
				sha256: runResult.rawJsonArtifact.sha256,
				sizeBytes: runResult.rawJsonArtifact.sizeBytes,
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
				metadata: nf.metadata,
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
		},
	});
	if (params.adapter === "nuclei-safe" && !toolVersion) {
		await scanRepo.updateToolRunStatus(toolRun.id, "failed", {
			exitCode: 127,
			metadata: { reasonCode: "tool_unavailable" },
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
	const result =
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
					targetOrigin: params.targetOrigin,
					timeoutSec: params.timeoutSec,
				});
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

export async function runDastStepIntoExistingScan(params: {
	db: AppDatabase;
	projectId: string;
	scanRunId: string;
	step: DastProfileStep;
	repoPath: string;
	timeoutSec?: number;
	createdByUserId?: string | null;
	preparedAutoTarget?: Awaited<ReturnType<typeof prepareDastTargetWorkspace>>;
}): Promise<DastStepResult> {
	const scanRepo = new ScanRepository(params.db);
	const dastRepo = new DastRepository(params.db);
	let preparedAutoTarget = params.preparedAutoTarget ?? null;
	const ownsPreparedTarget = !params.preparedAutoTarget;
	let targetConfigId: string | null = null;

	try {
		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "dast.started",
			message: `${params.step.profileId} DAST step started.`,
			data: { profileId: params.step.profileId },
		});

		if (!preparedAutoTarget) {
			preparedAutoTarget = await prepareDastTargetWorkspace({
				repoPath: params.repoPath,
				readinessTimeoutMs: params.step.options?.readinessTimeoutMs,
			});
		}
		const target = await dastRepo.createTargetConfig({
			projectId: params.projectId,
			...preparedAutoTarget.targetConfig,
			createdByUserId: params.createdByUserId ?? null,
			metadata: {
				...preparedAutoTarget.targetConfig.metadata,
				source: "scan-profile-dast-step",
				scanRunId: params.scanRunId,
				dastProfileId: params.step.profileId,
			},
		});
		targetConfigId = target.id;

		const runner = new DastRunner(params.db);
		const result = await runner.run({
			projectId: params.projectId,
			targetConfigId,
			profileId: params.step.profileId,
			scanRunId: params.scanRunId,
			runner: "host",
			timeoutSec: params.timeoutSec,
			maxRequests: params.step.options?.maxRequests,
			createdByUserId: params.createdByUserId ?? null,
			manageScanRunStatus: false,
			useStoredProfileConfig: false,
		});

		const autoTarget = {
			scriptName: preparedAutoTarget.plan.scriptName,
			command: preparedAutoTarget.plan.command,
			port: preparedAutoTarget.plan.port,
			origin: preparedAutoTarget.origin,
			warnings: preparedAutoTarget.plan.warnings,
		};

		if (!result.ok) {
			await scanRepo.createScanEvent({
				scanRunId: params.scanRunId,
				level: "error",
				eventType: "dast.failed",
				message: `${params.step.profileId} DAST step failed: ${result.message}`,
				data: {
					profileId: params.step.profileId,
					dastRunId: result.dastRunId,
					failureKind: result.failureKind,
					autoTarget,
				},
			});
			return {
				kind: "dast",
				profileId: params.step.profileId,
				required: params.step.required,
				status: "failed",
				outcome: result.outcome,
				findingCount: 0,
				dastRunId: result.dastRunId,
				targetOrigin: preparedAutoTarget.origin,
				error: result.message,
				autoTarget,
			};
		}

		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "info",
			eventType: "dast.completed",
			message: `${params.step.profileId} DAST step completed with outcome: ${result.outcome}.`,
			data: {
				profileId: params.step.profileId,
				dastRunId: result.dastRunId,
				autoTarget,
			},
		});
		return {
			kind: "dast",
			profileId: params.step.profileId,
			required: params.step.required,
			status: "completed",
			outcome: result.outcome,
			findingCount: result.findingIds.length,
			dastRunId: result.dastRunId,
			targetOrigin: preparedAutoTarget.origin,
			error: null,
			autoTarget,
		};
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "DAST step failed.";
		await scanRepo.createScanEvent({
			scanRunId: params.scanRunId,
			level: "error",
			eventType: "dast.failed",
			message: `${params.step.profileId} DAST step failed: ${message}`,
			data: { profileId: params.step.profileId, targetConfigId },
		});
		return {
			kind: "dast",
			profileId: params.step.profileId,
			required: params.step.required,
			status: "failed",
			outcome: "error",
			findingCount: 0,
			dastRunId: null,
			targetOrigin: preparedAutoTarget?.origin ?? null,
			error: message,
			autoTarget: preparedAutoTarget
				? {
						scriptName: preparedAutoTarget.plan.scriptName,
						command: preparedAutoTarget.plan.command,
						port: preparedAutoTarget.plan.port,
						origin: preparedAutoTarget.origin,
						warnings: preparedAutoTarget.plan.warnings,
					}
				: undefined,
		};
	} finally {
		if (targetConfigId && preparedAutoTarget) {
			await dastRepo
				.updateTargetConfig(targetConfigId, {
					enabled: false,
					metadata: {
						...preparedAutoTarget.targetConfig.metadata,
						source: "scan-profile-dast-step",
						scanRunId: params.scanRunId,
						dastProfileId: params.step.profileId,
						autoPreparedCompletedAt: new Date().toISOString(),
					},
				})
				.catch(() => undefined);
		}
		if (ownsPreparedTarget) {
			await preparedAutoTarget?.stop().catch(() => undefined);
		}
	}
}

export { runProfileScan } from "./profile-orchestrator";
