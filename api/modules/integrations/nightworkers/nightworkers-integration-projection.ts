import path from "node:path";
import type {
	IntegrationFindingPage,
	IntegrationReportStatus,
	IntegrationScanEventPage,
	IntegrationScanRunDetail,
} from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type { AppDatabase } from "../../../db";
import type {
	findings,
	scanEvents,
	scanReports,
	scanRuns,
} from "../../../db/schema";
import { buildScanRunSummary } from "../../scans/summary-builder";

type ScanRow = typeof scanRuns.$inferSelect;
type EventRow = typeof scanEvents.$inferSelect;
type FindingRow = typeof findings.$inferSelect;
type ReportRow = typeof scanReports.$inferSelect;

const SEVERITIES = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
	"unknown",
] as const;

export async function projectIntegrationScanRun(
	db: AppDatabase,
	scan: ScanRow,
): Promise<IntegrationScanRunDetail> {
	const metadata = scan.metadata as Record<string, unknown>;
	let summary: Awaited<ReturnType<typeof buildScanRunSummary>> | null = null;
	if (
		scan.status === "completed" ||
		scan.status === "failed" ||
		scan.status === "cancelled"
	) {
		summary = await buildScanRunSummary(db, scan.id).catch(() => null);
	}
	const coverage = summary ? coverageForSummary(summary) : null;
	const findingCount = summary?.totals.findingCount ?? 0;
	const status = normalizeScanStatus(scan.status);
	const terminal =
		status === "completed" || status === "failed" || status === "cancelled";
	const outcome = !terminal
		? null
		: status === "failed" || !summary
			? "unavailable"
			: status === "cancelled" || coverage?.gaps.length
				? "inconclusive"
				: findingCount > 0
					? "findings_present"
					: "no_findings";
	const target = integrationTargetMetadata(metadata);
	const steps = summary?.steps?.length ? summary.steps : summary?.tools;
	const completedSteps =
		steps?.filter((step) => step.status === "completed").length ?? 0;
	const runningStep = steps?.find((step) => step.status === "running");
	const currentStep = runningStep
		? "displayName" in runningStep
			? runningStep.displayName
			: runningStep.toolId
		: null;
	const severityCounts = emptySeverityCounts();
	for (const tool of summary?.tools ?? []) {
		for (const severity of SEVERITIES) {
			severityCounts[severity] += tool.severityCounts[severity];
		}
	}

	return {
		scanRunRef: scan.id,
		status,
		outcome,
		presetId:
			metadata.presetId === "quick" ||
			metadata.presetId === "standard" ||
			metadata.presetId === "deep"
				? metadata.presetId
				: null,
		profileRef: scan.profile,
		target,
		progress: {
			completedSteps,
			totalSteps: steps?.length ?? 0,
			currentStep,
		},
		summary:
			summary && coverage
				? {
						findingCount,
						severityCounts,
						coverage,
					}
				: null,
		lastEventSeq: scan.lastEventSeq,
		createdAt: scan.createdAt.toISOString(),
		startedAt: scan.startedAt?.toISOString() ?? null,
		completedAt: scan.completedAt?.toISOString() ?? null,
		error:
			status === "failed"
				? {
						code:
							typeof metadata.terminationReason === "string"
								? stableCode(metadata.terminationReason, "scan_failed")
								: "scan_failed",
						message: "Scan execution failed.",
						retryable: false,
					}
				: null,
	};
}

export function projectIntegrationScanEvent(
	event: EventRow,
): IntegrationScanEventPage["items"][number] {
	const data = event.data as Record<string, unknown>;
	const rawStepRef =
		typeof data.stepRef === "string"
			? data.stepRef
			: typeof data.stepId === "string"
				? data.stepId
				: typeof data.toolRunId === "string"
					? data.toolRunId
					: typeof data.toolName === "string"
						? data.toolName
						: null;
	return {
		seq: event.seq,
		level:
			event.level === "warn"
				? ("warning" as const)
				: event.level === "debug" ||
						event.level === "info" ||
						event.level === "error"
					? event.level
					: ("info" as const),
		type: safeCode(event.eventType),
		message: safeEventMessage(event.eventType),
		stepRef: boundedText(rawStepRef, 128),
		createdAt: event.createdAt.toISOString(),
	};
}

export function projectIntegrationFinding(
	finding: FindingRow,
	evidenceRows: Array<{ snippet: string | null }>,
	repositoryPath: string,
): IntegrationFindingPage["items"][number] {
	const metadata = finding.metadata as Record<string, unknown>;
	const location = finding.primaryLocation as Record<string, unknown> | null;
	const rawPath =
		typeof location?.path === "string"
			? location.path
			: typeof location?.file === "string"
				? location.file
				: null;
	const evidence = evidenceRows
		.map((row) => row.snippet)
		.filter((snippet): snippet is string => Boolean(snippet))
		.join("\n\n");
	const normalizedTool = finding.sourceTool.toLowerCase();
	const normalizedCategory =
		typeof metadata.category === "string"
			? metadata.category.toLowerCase()
			: null;
	const normalizedScanner =
		typeof metadata.scanner === "string"
			? metadata.scanner.toLowerCase()
			: null;
	const secretFinding =
		normalizedTool === "gitleaks" ||
		normalizedCategory === "secret" ||
		normalizedScanner === "secret";
	return {
		ref: finding.id,
		severity: normalizeSeverity(finding.severity),
		title: secretFinding
			? "Potential secret detected"
			: (boundedText(finding.title, 1_024) ?? "Security finding"),
		category: secretFinding
			? "secret"
			: boundedText(metadata.category ?? metadata.cwe, 256),
		tool: finding.sourceTool.slice(0, 128),
		ruleId: finding.ruleId?.slice(0, 512) || null,
		location: {
			path: integrationRepositoryRelativePath(rawPath, repositoryPath),
			startLine: positiveInteger(location?.startLine ?? location?.line),
			endLine: positiveInteger(location?.endLine),
		},
		description: secretFinding
			? "A potential secret was detected; sensitive match content was redacted."
			: boundedText(finding.description, 16_384),
		evidence: secretFinding
			? redactSecretEvidence(evidence || null)
			: boundedText(evidence, 16_384),
		recommendation: boundedText(
			metadata.recommendation ?? metadata.remediation,
			16_384,
		),
		references: safeIntegrationReferences(metadata.references),
	};
}

export function projectIntegrationReport(
	report: ReportRow,
	artifact?: {
		sizeBytes: number;
		sha256: string;
		kind?: string;
		format?: string;
		metadata?: unknown;
	} | null,
) {
	const options = report.options as Record<string, unknown>;
	const routing =
		options.providerRouting && typeof options.providerRouting === "object"
			? (options.providerRouting as Record<string, unknown>)
			: null;
	const provider =
		typeof routing?.providerName === "string"
			? routing.providerName
			: typeof routing?.provider === "string"
				? routing.provider
				: typeof routing?.providerEndpointId === "string"
					? routing.providerEndpointId
					: null;
	const model = typeof routing?.model === "string" ? routing.model : null;
	const artifactMetadata =
		artifact?.metadata && typeof artifact.metadata === "object"
			? (artifact.metadata as Record<string, unknown>)
			: null;
	const validArtifact =
		artifact?.kind === "report" &&
		artifact.format === "markdown" &&
		artifactMetadata?.reportId === report.id &&
		Number.isSafeInteger(artifact.sizeBytes) &&
		artifact.sizeBytes >= 0 &&
		/^[0-9a-f]{64}$/.test(artifact.sha256)
			? artifact
			: null;
	return {
		reportRef: report.id,
		scanRunRef: report.scanRunId,
		status: normalizeReportStatus(report.status),
		summaryMode: "deterministic_with_llm_summary" as const,
		title: report.title?.slice(0, 512) || null,
		llm:
			provider && model
				? { provider: provider.slice(0, 128), model: model.slice(0, 256) }
				: null,
		createdAt: report.createdAt.toISOString(),
		startedAt: report.startedAt?.toISOString() ?? null,
		completedAt: report.completedAt?.toISOString() ?? null,
		content:
			report.status === "completed" && validArtifact
				? {
						mediaType: "text/markdown" as const,
						byteLength: validArtifact.sizeBytes,
						sha256: validArtifact.sha256,
					}
				: null,
		error:
			report.status === "failed"
				? {
						code: stableCode(
							report.errorCode ?? "report_generation_failed",
							"report_generation_failed",
						),
						message: "Report generation failed.",
						retryable: report.retryable ?? false,
					}
				: null,
	};
}

function coverageForSummary(
	summary: Awaited<ReturnType<typeof buildScanRunSummary>>,
) {
	const steps = summary.steps?.length ? summary.steps : summary.tools;
	let completed = 0;
	let skipped = 0;
	let failed = 0;
	const gaps: Array<{
		code:
			| "tool_unavailable"
			| "tool_failed"
			| "tool_timed_out"
			| "target_unsupported"
			| "runtime_not_configured"
			| "result_incomplete";
		message: string;
	}> = [];
	for (const step of steps) {
		const coverageEffect =
			"coverageEffect" in step
				? step.coverageEffect
				: step.metadata?.coverageEffect;
		const coverageIncomplete =
			coverageEffect === "gap" || coverageEffect === "partial";
		if (step.status === "completed") {
			completed += 1;
			if (!coverageIncomplete) continue;
		}
		if (
			step.status !== "completed" &&
			(step.status === "skipped" ||
				step.status === "not_applicable" ||
				step.status === "unavailable")
		) {
			skipped += 1;
		} else if (step.status !== "completed") {
			failed += 1;
		}
		if (!step.required) continue;
		const text =
			`${step.error ?? ""} ${"reasonCode" in step ? (step.reasonCode ?? "") : ""}`.toLowerCase();
		const code = text.includes("timeout")
			? ("tool_timed_out" as const)
			: text.includes("runtime")
				? ("runtime_not_configured" as const)
				: text.includes("unavailable")
					? ("tool_unavailable" as const)
					: text.includes("target") || text.includes("not_applicable")
						? ("target_unsupported" as const)
						: step.status === "failed"
							? ("tool_failed" as const)
							: ("result_incomplete" as const);
		gaps.push({
			code,
			message: `Required scan step ${"displayName" in step ? step.displayName : step.toolId} did not complete.`,
		});
	}
	return { completed, skipped, failed, gaps };
}

function integrationTargetMetadata(metadata: Record<string, unknown>) {
	const target =
		metadata.target && typeof metadata.target === "object"
			? (metadata.target as Record<string, unknown>)
			: metadata.integrationTarget &&
					typeof metadata.integrationTarget === "object"
				? (metadata.integrationTarget as Record<string, unknown>)
				: {};
	return {
		kind:
			target.kind === "working_tree"
				? ("working_tree" as const)
				: ("full" as const),
		digest:
			typeof target.digest === "string" && /^[0-9a-f]{64}$/.test(target.digest)
				? target.digest
				: "0".repeat(64),
		sourceRevision:
			typeof target.sourceRevision === "string" ? target.sourceRevision : null,
	};
}

function normalizeScanStatus(value: string) {
	return value === "queued" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
		? value
		: ("failed" as const);
}

function normalizeReportStatus(value: string): IntegrationReportStatus {
	return value === "queued" ||
		value === "running" ||
		value === "completed" ||
		value === "failed"
		? value
		: ("failed" as const);
}

function normalizeSeverity(value: string) {
	const normalized = value.toLowerCase();
	return SEVERITIES.includes(normalized as (typeof SEVERITIES)[number])
		? (normalized as (typeof SEVERITIES)[number])
		: ("unknown" as const);
}

function emptySeverityCounts(): Record<(typeof SEVERITIES)[number], number> {
	return {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		info: 0,
		unknown: 0,
	};
}

function safeEventMessage(eventType: string): string {
	if (eventType === "scan.queued") return "Scan was queued.";
	if (eventType === "scan.started") return "Scan execution started.";
	if (eventType === "scan.completed") return "Scan execution completed.";
	if (eventType === "scan.cancelled") return "Scan was cancelled.";
	if (eventType.startsWith("tool.")) return "A scan tool updated its status.";
	if (eventType.includes("failed") || eventType.includes("error")) {
		return "A scan execution error was recorded.";
	}
	return "Scan progress was updated.";
}

export function integrationRepositoryRelativePath(
	value: string | null,
	repositoryPath: string,
): string | null {
	if (!value || value.includes("\0")) return null;
	const normalized = value.replaceAll("\\", "/");
	if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return null;
	if (!path.isAbsolute(value) && !path.win32.isAbsolute(value)) {
		const clean = path.posix.normalize(normalized);
		return !clean ||
			clean === "." ||
			clean === ".." ||
			clean.startsWith("../") ||
			path.posix.isAbsolute(clean)
			? null
			: clean.slice(0, 4_096);
	}
	if (path.win32.isAbsolute(value) && !path.isAbsolute(value)) return null;
	const relative = path.relative(repositoryPath, value);
	return relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
		? null
		: relative.replaceAll(path.sep, "/").slice(0, 4_096);
}

export function safeIntegrationReferences(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		try {
			const url = new URL(item);
			if (
				(url.protocol === "https:" || url.protocol === "http:") &&
				!url.username &&
				!url.password
			) {
				const serialized = url.toString();
				if (serialized.length <= 2_048) result.push(serialized);
			}
		} catch {
			// Ignore non-URL references at the integration boundary.
		}
		if (result.length >= 20) break;
	}
	return result;
}

function redactSecretEvidence(value: string | null): string | null {
	return value ? "[REDACTED: secret finding evidence]" : null;
}

function boundedText(value: unknown, limit = 2_000): string | null {
	if (typeof value !== "string" || !value) return null;
	return value
		.replace(
			/(api[_-]?key|access[_-]?token|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
			"$1=[REDACTED]",
		)
		.replace(/\bvwi_[0-9a-f]{16}_[A-Za-z0-9_-]{43}\b/g, "[REDACTED]")
		.slice(0, limit);
}

function positiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: null;
}

function safeCode(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "_")
			.slice(0, 128) || "unknown"
	);
}

function stableCode(value: string, fallback: string): string {
	return /^[a-z][a-z0-9._-]{0,127}$/.test(value) &&
		!/\bvwi_[0-9a-f]{16}_[A-Za-z0-9_-]{43}\b/.test(value)
		? value
		: fallback;
}
