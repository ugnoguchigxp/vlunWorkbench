import type { AppDatabase } from "../../db";
import {
	ScanRepository,
	ArtifactRepository,
	FindingRepository,
} from "./repositories";
import { ArtifactStorage } from "./artifact-storage";
import { getProfileById } from "./profiles";

// Import runners
import { SemgrepRunner } from "./tools/semgrep-runner";
import { GitleaksRunner } from "./tools/gitleaks-runner";
import { OsvRunner } from "./tools/osv-runner";
import { TrivyRunner } from "./tools/trivy-runner";

// Import normalizers
import { normalizeSemgrep } from "./normalizers/semgrep";
import { normalizeGitleaks } from "./normalizers/gitleaks";
import { normalizeOsv } from "./normalizers/osv";
import { normalizeTrivy } from "./normalizers/trivy";

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
	message?: string;
	toolResults: ToolResult[];
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

	// 1. Resolve Runner & Normalizer
	let runner: SemgrepRunner | GitleaksRunner | OsvRunner | TrivyRunner;
	let normalizer: (rawJson: unknown, opts?: { stderr?: string }) => any[];
	let toolName: string;
	let defaultCommand: string;

	switch (params.toolId) {
		case "semgrep":
			runner = new SemgrepRunner(params.artifactStorage);
			normalizer = normalizeSemgrep;
			toolName = "semgrep";
			defaultCommand = `semgrep scan --config ${options.config ?? "auto"}`;
			break;
		case "gitleaks":
			runner = new GitleaksRunner(params.artifactStorage);
			normalizer = normalizeGitleaks;
			toolName = "gitleaks";
			defaultCommand = "gitleaks detect";
			break;
		case "osv":
			runner = new OsvRunner(params.artifactStorage);
			normalizer = normalizeOsv;
			toolName = "osv";
			defaultCommand = "osv-scanner";
			break;
		case "trivy":
			runner = new TrivyRunner(params.artifactStorage);
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
					error: errMsg,
					options,
					timeoutSec: timeoutSec ?? null,
				},
			});
		});
		throw new Error(errMsg);
	}

	let exitCode: number | null = null;
	let findingCount = 0;
	let evidenceCount = 0;
	const artifactIds: string[] = [];

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
		if (params.toolId === "semgrep") {
			runResult = await (runner as SemgrepRunner).run(
				params.scanRunId,
				params.repoPath,
				{
					config: (options.config as string) ?? "auto",
					timeoutSec,
					maxTargetBytes: options.maxTargetBytes
						? Number(options.maxTargetBytes)
						: undefined,
				},
			);
		} else {
			runResult = await (
				runner as GitleaksRunner | OsvRunner | TrivyRunner
			).run(params.scanRunId, params.repoPath, { timeoutSec });
		}

		exitCode = runResult.exitCode;

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
				elapsedMs: runResult.elapsedMs,
				artifactIds,
				findingCount,
				evidenceCount,
				options,
				timeoutSec: timeoutSec ?? null,
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
					artifactIds,
					findingCount,
					evidenceCount,
					options,
					timeoutSec: timeoutSec ?? null,
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
}): Promise<ProfileScanResult> {
	const scanRepo = new ScanRepository(params.db);
	const artifactStorage = new ArtifactStorage();

	const profile = getProfileById(params.profileId);
	if (!profile) {
		throw new Error(`Profile not found: ${params.profileId}`);
	}

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
			continueOnToolFailure,
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
				options: tool.options,
				artifactStorage,
				timeoutSec: resolvedTimeout,
				repoPath: params.repoPath,
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
			profileOutcome,
			continueOnToolFailure,
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

	return {
		ok: profileOutcome !== "failed",
		scanRunId: scanRun.id,
		profileId: params.profileId,
		status: finalScanStatus,
		profileOutcome,
		toolResults,
	};
}
