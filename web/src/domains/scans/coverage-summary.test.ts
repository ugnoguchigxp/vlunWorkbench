import { describe, expect, it } from "vitest";
import type {
	AttackSurfaceItem,
	DiagnosticReport,
	Finding,
	ScanRun,
	SecurityCheckResult,
} from "../../api";
import { buildCoverageSummary, getCoverageGapItems } from "./coverage-summary";

const now = "2026-06-27T00:00:00.000Z";

function scanRun(overrides: Partial<ScanRun> = {}): ScanRun {
	return {
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
	};
}

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		id: "finding-1",
		scanRunId: "scan-1",
		projectId: "project-1",
		sourceTool: "semgrep",
		ruleId: "rule-1",
		title: "Finding",
		description: "Finding description",
		severity: "high",
		confidence: "static",
		status: "open",
		primaryLocation: null,
		fingerprint: "fingerprint-1",
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function attackSurfaceItem(
	overrides: Partial<AttackSurfaceItem> = {},
): AttackSurfaceItem {
	return {
		id: "attack-surface-1",
		projectId: "project-1",
		scanRunId: "scan-1",
		category: "service",
		name: "App",
		kind: "http",
		locationJson: {},
		boundaryJson: {},
		evidenceRefsJson: [],
		confidence: "high",
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function securityCheck(
	overrides: Partial<SecurityCheckResult> = {},
): SecurityCheckResult {
	return {
		id: "security-check-1",
		projectId: "project-1",
		scanRunId: "scan-1",
		checkId: "check-1",
		attackSurfaceItemId: null,
		status: "pass",
		outcome: null,
		title: "Check",
		summary: "Summary",
		evidenceRefsJson: [],
		remediationHint: null,
		coverageGap: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function diagnosticReport(
	overrides: Partial<DiagnosticReport> = {},
): DiagnosticReport {
	return {
		id: "diagnostic-report-1",
		projectId: "project-1",
		scanRunId: "scan-1",
		reportKind: "zero-finding",
		status: "completed",
		summary: "Report summary",
		checkedCategoriesJson: [],
		coverageGapsJson: [],
		residualRisksJson: [],
		recommendedNextActionsJson: [],
		artifactId: null,
		metadata: {},
		errorMessage: null,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function build(overrides: Partial<Parameters<typeof buildCoverageSummary>[0]> = {}) {
	return buildCoverageSummary({
		scanRun: scanRun(),
		findings: [],
		attackSurfaceItems: [],
		securityCheckResults: [],
		diagnosticReports: [],
		scanSummary: null,
		...overrides,
	});
}

describe("buildCoverageSummary", () => {
	it("returns all missing actions for zero findings with no diagnostics", () => {
		const summary = build();

		expect(summary.hasFindings).toBe(false);
		expect(summary.missingActions).toEqual([
			"run_inventory",
			"run_security_checks",
			"generate_diagnostic_report",
		]);
	});

	it("removes run_inventory when attack surface items exist", () => {
		const summary = build({
			attackSurfaceItems: [attackSurfaceItem()],
		});

		expect(summary.attackSurfaceCounts).toEqual({ service: 1 });
		expect(summary.missingActions).not.toContain("run_inventory");
	});

	it("removes run_security_checks when check results exist", () => {
		const summary = build({
			securityCheckResults: [securityCheck()],
		});

		expect(summary.checkStatusCounts).toEqual({ pass: 1 });
		expect(summary.missingActions).not.toContain("run_security_checks");
	});

	it("removes generate_diagnostic_report when a completed report exists", () => {
		const summary = build({
			diagnosticReports: [diagnosticReport()],
		});

		expect(summary.latestDiagnosticReport?.id).toBe("diagnostic-report-1");
		expect(summary.missingActions).not.toContain("generate_diagnostic_report");
	});

	it("lists warn, manual_review, not_checked, and fail checks as coverage gaps", () => {
		const summary = build({
			securityCheckResults: [
				securityCheck({ id: "warn-1", status: "warn" }),
				securityCheck({ id: "manual-1", status: "manual_review" }),
				securityCheck({ id: "unchecked-1", status: "not_checked" }),
				securityCheck({ id: "fail-1", status: "fail" }),
			],
		});

		expect(getCoverageGapItems(summary).map((gap) => gap.status)).toEqual([
			"warn",
			"manual_review",
			"not_checked",
			"fail",
		]);
	});

	it("uses the existing security check category when gap metadata has no category", () => {
		const summary = build({
			securityCheckResults: [
				securityCheck({
					checkId: "execution.no_shell_string_for_tool_runs",
					status: "manual_review",
					metadata: {},
				}),
			],
		});

		expect(summary.coverageGaps[0]).toMatchObject({
			category: "execution_boundary",
		});
	});

	it("counts pass checks but does not list them as gaps", () => {
		const summary = build({
			findings: [finding()],
			securityCheckResults: [securityCheck({ status: "pass" })],
		});

		expect(summary.hasFindings).toBe(true);
		expect(summary.checkStatusCounts.pass).toBe(1);
		expect(summary.coverageGaps).toEqual([]);
	});
});
