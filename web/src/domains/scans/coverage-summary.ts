import type {
	AttackSurfaceItem,
	DiagnosticReport,
	Finding,
	ScanRun,
	ScanRunSummary,
	SecurityCheckResult,
} from "../../api";

export type CoverageGapStatus =
	| "warn"
	| "manual_review"
	| "not_checked"
	| "fail";

export type CoverageSummary = {
	scanRunId: string;
	hasFindings: boolean;
	toolCoverage: Array<{
		toolName: string;
		status: string;
		findingCount: number;
	}>;
	attackSurfaceCounts: Record<string, number>;
	checkStatusCounts: Record<string, number>;
	coverageGaps: Array<{
		id: string;
		status: CoverageGapStatus;
		title: string;
		summary: string;
		category?: string;
		attackSurfaceItemId?: string | null;
	}>;
	latestDiagnosticReport: DiagnosticReport | null;
	missingActions: Array<
		"run_inventory" | "run_security_checks" | "generate_diagnostic_report"
	>;
};

type BuildCoverageSummaryInput = {
	scanRun: ScanRun | null;
	findings: Finding[];
	attackSurfaceItems: AttackSurfaceItem[];
	securityCheckResults: SecurityCheckResult[];
	diagnosticReports: DiagnosticReport[];
	scanSummary?: ScanRunSummary | null;
};

const gapStatuses = new Set<SecurityCheckResult["status"]>([
	"warn",
	"manual_review",
	"not_checked",
	"fail",
]);

const checkCategoryById: Record<string, string> = {
	"auth.required_for_project_routes": "auth_boundary",
	"auth.admin_routes_require_admin": "auth_boundary",
	"artifact.download_scoped_to_owner": "artifact_access",
	"path.repo_access_uses_scope_guard": "file_path_boundary",
	"execution.no_shell_string_for_tool_runs": "execution_boundary",
	"execution.runner_scrubs_sensitive_env": "execution_boundary",
	"execution.docker_no_socket_mount": "execution_boundary",
	"config.production_jwt_secret_required": "configuration_boundary",
	"config.cookie_security_reviewed": "configuration_boundary",
	"scan.zero_finding_has_coverage_context": "diagnostic_coverage",
};

export function buildCoverageSummary(
	input: BuildCoverageSummaryInput,
): CoverageSummary {
	const scanRunId = input.scanRun?.id ?? input.scanSummary?.scanRunId ?? "";
	const scanFindings = input.findings.filter((finding) =>
		scanRunId ? finding.scanRunId === scanRunId : true,
	);
	const scanAttackSurfaceItems = input.attackSurfaceItems.filter((item) =>
		scanRunId ? item.scanRunId === scanRunId : true,
	);
	const scanSecurityCheckResults = input.securityCheckResults.filter(
		(result) => (scanRunId ? result.scanRunId === scanRunId : true),
	);
	const scanDiagnosticReports = input.diagnosticReports.filter((report) =>
		scanRunId ? report.scanRunId === scanRunId : true,
	);

	const attackSurfaceCounts = countBy(
		scanAttackSurfaceItems,
		(item) => item.category || "uncategorized",
	);
	const checkStatusCounts = countBy(
		scanSecurityCheckResults,
		(result) => result.status,
	);
	const attackSurfaceById = new Map(
		scanAttackSurfaceItems.map((item) => [item.id, item]),
	);
	const completedReports = scanDiagnosticReports
		.filter((report) => report.status === "completed")
		.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);

	const missingActions: CoverageSummary["missingActions"] = [];
	if (scanAttackSurfaceItems.length === 0) missingActions.push("run_inventory");
	if (scanSecurityCheckResults.length === 0)
		missingActions.push("run_security_checks");
	if (!completedReports[0]) missingActions.push("generate_diagnostic_report");

	return {
		scanRunId,
		hasFindings: scanFindings.length > 0,
		toolCoverage:
			input.scanSummary?.scanRunId === scanRunId
				? input.scanSummary.tools.map((tool) => ({
						toolName: tool.toolId,
						status: tool.status,
						findingCount: tool.findingCount,
					}))
				: [],
		attackSurfaceCounts,
		checkStatusCounts,
		coverageGaps: scanSecurityCheckResults
			.filter((result) => gapStatuses.has(result.status))
			.map((result) => ({
				id: result.id,
				status: result.status as CoverageGapStatus,
				title: result.title,
				summary: result.coverageGap || result.summary,
				category: resolveCheckCategory(result, attackSurfaceById),
				attackSurfaceItemId: result.attackSurfaceItemId,
			})),
		latestDiagnosticReport: completedReports[0] ?? null,
		missingActions,
	};
}

function resolveCheckCategory(
	result: SecurityCheckResult,
	attackSurfaceById: Map<string, AttackSurfaceItem>,
): string | undefined {
	if (typeof result.metadata.category === "string") {
		return result.metadata.category;
	}
	if (result.attackSurfaceItemId) {
		const attackSurfaceCategory = attackSurfaceById.get(
			result.attackSurfaceItemId,
		)?.category;
		if (attackSurfaceCategory) return attackSurfaceCategory;
	}
	return checkCategoryById[result.checkId];
}

export function getCoverageGapItems(summary: CoverageSummary) {
	return summary.coverageGaps;
}

function countBy<T>(
	items: T[],
	getKey: (item: T) => string,
): Record<string, number> {
	return items.reduce<Record<string, number>>((counts, item) => {
		const key = getKey(item);
		counts[key] = (counts[key] ?? 0) + 1;
		return counts;
	}, {});
}
