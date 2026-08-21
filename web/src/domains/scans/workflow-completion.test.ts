import { describe, expect, it } from "vitest";
import type {
	AutomatedDiagnosticRun,
	Finding,
	ScanReport,
	ScanRun,
} from "../../api";
import type { EvidenceQualityView } from "./evidence-quality";
import { buildWorkflowCompletion } from "./workflow-completion";

const now = "2026-06-27T00:00:00.000Z";

const scanRun = (overrides: Partial<ScanRun> = {}): ScanRun => ({
	id: "scan-1",
	projectId: "project-1",
	profile: "baseline",
	status: "completed",
	startedAt: now,
	completedAt: now,
	createdByUserId: null,
	summary: null,
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const finding = (overrides: Partial<Finding> = {}): Finding => ({
	id: "finding-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	sourceTool: "semgrep",
	ruleId: "rule",
	title: "Risk",
	description: "risk",
	severity: "high",
	confidence: "static",
	status: "open",
	primaryLocation: { path: "src/app.ts" },
	fingerprint: "fp",
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const evidence = (level: EvidenceQualityView["level"]): EvidenceQualityView => ({
	findingId: "finding-1",
	level,
	dataCompleteness: "complete",
	dataCompletenessLabel: "完全評価",
	score: 80,
	label: level,
	reasons: [],
	missingSignals: [],
	presentSignals: [],
	recommendedNextAction: "ready_for_report",
});

const report = (): ScanReport => ({
	id: "report-1",
	scanRunId: "scan-1",
	artifactId: null,
	format: "markdown",
	title: "Report",
	summary: null,
	options: {
		includeFalsePositives: true,
		includeDeferred: true,
		includeUndecided: true,
	},
	status: "completed",
	stage: "canonical_final",
	errorMessage: null,
	generatedByUserId: null,
	createdAt: now,
	updatedAt: now,
});

const diagnostic = (
	overrides: Partial<AutomatedDiagnosticRun> = {},
): AutomatedDiagnosticRun => ({
	id: "diagnostic-1",
	scanRunId: "scan-1",
	inputSnapshotHash: "a".repeat(64),
	scannerProvenanceHash: "b".repeat(64),
	pipelineVersion: "automated-scan-diagnostic-v1",
	status: "completed",
	readiness: "ready",
	scanReviewId: "review-1",
	scanReportId: "report-1",
	limitationCodes: [],
	errorMessage: null,
	attemptCount: 1,
	startedAt: now,
	completedAt: now,
	createdAt: now,
	updatedAt: now,
	...overrides,
});

describe("buildWorkflowCompletion", () => {
	it("legacy scans do not require per-finding reviews or decisions", () => {
		const result = buildWorkflowCompletion({ scanRun: scanRun(), findings: [finding()] });
		expect(result.stage).toBe("report_ready");
		expect(result.nextBestAction).toMatchObject({
			action: "generate_report",
		});
	});

	it("waits automatically when an automated diagnostic was requested", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun({
				metadata: { automaticDiagnosticRequested: true },
			}),
			findings: [finding()],
		});
		expect(result.stage).toBe("diagnostic_running");
		expect(result.nextBestAction).toBeNull();
		expect(result.checklist.find((entry) => entry.id === "llm")).toMatchObject({
			status: "incomplete",
			count: "実行中",
		});
	});

	it("completed automated diagnosis makes the report the next output", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun({ metadata: { automaticDiagnosticRequested: true } }),
			findings: [finding()],
			automatedDiagnostics: [diagnostic({ scanReportId: null })],
		});
		expect(result.stage).toBe("report_ready");
		expect(result.checklist.find((entry) => entry.id === "llm")).toMatchObject({
			status: "complete",
			label: "証跡制約付き LLM 診断",
		});
	});

	it("completed-with-limitations remains usable without human approval", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun({ metadata: { automaticDiagnosticRequested: true } }),
			findings: [finding()],
			automatedDiagnostics: [
				diagnostic({
					status: "completed_with_limitations",
					readiness: "ready_with_limitations",
					limitationCodes: ["llm_unavailable"],
				}),
			],
		});
		expect(result.stage).toBe("report_ready");
		expect(
			result.checklist.find((entry) => entry.id === "llm")?.explanation,
		).toContain("llm_unavailable");
	});

	it("failed diagnostics expose a retry instead of an approval gate", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun({ metadata: { automaticDiagnosticRequested: true } }),
			findings: [finding()],
			automatedDiagnostics: [
				diagnostic({
					status: "failed",
					readiness: "failed",
					errorMessage: "provider timeout",
				}),
			],
		});
		expect(result.stage).toBe("diagnostic_retry");
		expect(result.nextBestAction).toMatchObject({
			action: "retry_diagnostic",
		});
	});

	it("manual decision annotations do not change automatic completion", () => {
		const item = finding({
			latestDecision: {
				id: "d1",
				findingId: "finding-1",
				decision: "accepted",
				reason: "accepted_risk",
				comment: null,
				linkedReviewId: null,
				decidedByUserId: null,
				createdAt: now,
				updatedAt: now,
			},
		});
		const result = buildWorkflowCompletion({
			scanRun: scanRun(),
			findings: [item],
			evidenceByFindingId: new Map([[item.id, evidence("strong")]]),
		});
		expect(result.stage).toBe("report_ready");
	});

	it("completed report and automated diagnosis return report_generated", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun({ metadata: { automaticDiagnosticRequested: true } }),
			findings: [],
			reports: [report()],
			automatedDiagnostics: [diagnostic()],
			coverageSummary: {
				scanRunId: "scan-1",
				hasFindings: false,
				sourceSast: null,
				toolCoverage: [],
				attackSurfaceCounts: {},
				checkStatusCounts: {},
				coverageGaps: [],
				latestDiagnosticReport: null,
				missingActions: [],
			},
		});
		expect(result.stage).toBe("report_generated");
	});

	it("does not treat a preliminary report as the current final report", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun({ metadata: { automaticDiagnosticRequested: true } }),
			findings: [],
			reports: [{ ...report(), stage: "preliminary" }],
			automatedDiagnostics: [diagnostic({ scanReportId: null })],
		});
		expect(result.stage).toBe("report_ready");
	});

	it("does not mark blocked or incomplete profiles as scanner-complete", () => {
		const blocked = buildWorkflowCompletion({
			scanRun: scanRun({
				status: "failed",
				metadata: { profileOutcome: "blocked" },
			}),
			findings: [],
		});
		expect(blocked.stage).toBe("scan_blocked");
		expect(blocked.checklist[0]?.status).toBe("blocked");

		const incomplete = buildWorkflowCompletion({
			scanRun: scanRun({
				metadata: { profileOutcome: "completed_with_warnings" },
			}),
			findings: [],
		});
		expect(incomplete.stage).toBe("scan_incomplete");
	});

	it("zero-finding scans use the same automatic pipeline", () => {
		const result = buildWorkflowCompletion({
			scanRun: scanRun({ metadata: { automaticDiagnosticRequested: true } }),
			findings: [],
			coverageSummary: {
				scanRunId: "scan-1",
				hasFindings: false,
				sourceSast: null,
				toolCoverage: [],
				attackSurfaceCounts: {},
				checkStatusCounts: {},
				coverageGaps: [],
				latestDiagnosticReport: null,
				missingActions: ["generate_diagnostic_report"],
			},
		});
		expect(result.stage).toBe("diagnostic_running");
		expect(result.nextBestAction).toBeNull();
	});
});
