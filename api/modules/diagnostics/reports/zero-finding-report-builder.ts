import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../../db";
import { findings, projects, scanRuns, toolRuns } from "../../../db/schema";
import { ScanArtifactSink } from "../../scans/artifact-sink";
import { ArtifactStorage } from "../../scans/artifact-storage";
import { ArtifactRepository } from "../../scans/repositories";
import { SECURITY_CHECK_DEFINITIONS } from "../checks/check-registry";
import {
	AttackSurfaceRepository,
	DiagnosticReportRepository,
	SecurityCheckRepository,
} from "../repository";

export type DiagnosticReportBuildResult = {
	ok: boolean;
	reportId: string;
	artifactId: string | null;
	artifactPath: string | null;
	status: "completed" | "failed";
	summary: string;
	error?: string;
};

export async function buildZeroFindingDiagnosticReport(params: {
	db: AppDatabase;
	projectId: string;
	scanRunId: string;
	outputTitle?: string;
	artifactStorage?: ArtifactStorage;
}): Promise<DiagnosticReportBuildResult> {
	const reportRepo = new DiagnosticReportRepository(params.db);
	const report = await reportRepo.createReport({
		projectId: params.projectId,
		scanRunId: params.scanRunId,
		reportKind: "zero-finding",
		status: "running",
		summary: null,
		checkedCategories: [],
		coverageGaps: [],
		residualRisks: [],
		recommendedNextActions: [],
		metadata: { source: "zero-finding-report-builder" },
	});

	try {
		const data = await loadReportData(
			params.db,
			params.projectId,
			params.scanRunId,
		);
		const summary = buildSummary(data);
		const checkedCategories = buildCheckedCategories(data);
		const coverageGaps = buildCoverageGaps(data);
		const residualRisks = buildResidualRisks(data, coverageGaps);
		const recommendedNextActions = buildRecommendedNextActions(
			data,
			coverageGaps,
		);
		const markdown = buildMarkdown({
			title: params.outputTitle ?? "Zero Finding Diagnostic Summary",
			summary,
			checkedCategories,
			coverageGaps,
			residualRisks,
			recommendedNextActions,
			...data,
		});
		const storage = params.artifactStorage ?? new ArtifactStorage();
		const artifact = await new ScanArtifactSink(
			storage,
			new ArtifactRepository(params.db),
			{ scanRunId: params.scanRunId, kind: "diagnostic", id: report.id },
		).saveText({
			role: "diagnostic_report",
			format: "markdown",
			content: markdown,
			metadata: { diagnosticReportId: report.id, reportKind: "zero-finding" },
		});
		await reportRepo.updateReport(report.id, {
			status: "completed",
			summary,
			checkedCategories,
			coverageGaps,
			residualRisks,
			recommendedNextActions,
			artifactId: artifact.id,
		});
		return {
			ok: true,
			reportId: report.id,
			artifactId: artifact.id,
			artifactPath: artifact.path,
			status: "completed",
			summary,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await reportRepo.updateReport(report.id, {
			status: "failed",
			errorMessage: message,
		});
		return {
			ok: false,
			reportId: report.id,
			artifactId: null,
			artifactPath: null,
			status: "failed",
			summary: "Failed to build zero-finding diagnostic report.",
			error: message,
		};
	}
}

async function loadReportData(
	db: AppDatabase,
	projectId: string,
	scanRunId: string,
) {
	const [project] = await db
		.select()
		.from(projects)
		.where(eq(projects.id, projectId));
	if (!project) throw new Error(`Project not found: ${projectId}`);
	const [scanRun] = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.id, scanRunId));
	if (!scanRun) throw new Error(`Scan run not found: ${scanRunId}`);
	if (scanRun.projectId !== projectId) {
		throw new Error("Scan run does not belong to project.");
	}
	const toolRunRows = await db
		.select()
		.from(toolRuns)
		.where(eq(toolRuns.scanRunId, scanRunId));
	const findingRows = await db
		.select()
		.from(findings)
		.where(eq(findings.scanRunId, scanRunId));
	const attackSurface = await new AttackSurfaceRepository(db).listForScan(
		projectId,
		scanRunId,
	);
	const checkResults = await new SecurityCheckRepository(db).listResultsForScan(
		projectId,
		scanRunId,
	);
	return {
		project,
		scanRun,
		toolRunRows,
		findingRows,
		attackSurface,
		checkResults,
	};
}

function buildSummary(
	data: Awaited<ReturnType<typeof loadReportData>>,
): string {
	if (data.findingRows.length === 0) {
		return `No normalized findings were produced by scan ${data.scanRun.id}. Diagnostic context includes ${data.attackSurface.length} attack surface items and ${data.checkResults.length} security check results.`;
	}
	return `Scan ${data.scanRun.id} produced ${data.findingRows.length} normalized findings. Diagnostic coverage context is included for review.`;
}

function buildCheckedCategories(
	data: Awaited<ReturnType<typeof loadReportData>>,
) {
	const counts = new Map<string, { inventory: number; checks: number }>();
	const checkCategoryById = new Map(
		SECURITY_CHECK_DEFINITIONS.map((definition) => [
			definition.checkId,
			definition.category,
		]),
	);
	for (const item of data.attackSurface) {
		const current = counts.get(item.category) ?? { inventory: 0, checks: 0 };
		current.inventory++;
		counts.set(item.category, current);
	}
	for (const result of data.checkResults) {
		const category = checkCategoryById.get(result.checkId) ?? "diagnostic";
		const current = counts.get(category) ?? { inventory: 0, checks: 0 };
		current.checks++;
		counts.set(category, current);
	}
	return Array.from(counts.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([category, count]) => ({ category, ...count }));
}

function buildCoverageGaps(data: Awaited<ReturnType<typeof loadReportData>>) {
	const gaps: Array<Record<string, unknown>> = [];
	if (data.attackSurface.length === 0) {
		gaps.push({
			category: "attack_surface",
			message: "Attack Surface Inventory has not been generated for this scan.",
		});
	}
	if (data.checkResults.length === 0) {
		gaps.push({
			category: "security_checks",
			message: "Security checks have not been generated for this scan.",
		});
	}
	for (const result of data.checkResults) {
		if (result.coverageGap) {
			gaps.push({
				category: result.checkId,
				status: result.status,
				message: result.coverageGap,
			});
		}
	}
	if (!data.toolRunRows.some((tool) => tool.toolName === "semgrep")) {
		gaps.push({
			category: "static_analysis",
			message: "Semgrep tool run was not observed for this scan.",
		});
	}
	if (!data.toolRunRows.some((tool) => tool.toolName === "trivy")) {
		gaps.push({
			category: "filesystem_dependency_scan",
			message: "Trivy tool run was not observed for this scan.",
		});
	}
	return gaps;
}

function buildResidualRisks(
	data: Awaited<ReturnType<typeof loadReportData>>,
	coverageGaps: Array<Record<string, unknown>>,
) {
	const risks: Array<Record<string, unknown>> = [
		{
			category: "zero_finding_interpretation",
			message:
				"No normalized findings does not prove that vulnerabilities do not exist.",
		},
	];
	if (coverageGaps.length > 0) {
		risks.push({
			category: "coverage_gap",
			message:
				"Some diagnostic categories were not checked or require manual review.",
		});
	}
	if (!data.checkResults.some((result) => result.checkId.includes("dast"))) {
		risks.push({
			category: "runtime_behavior",
			message:
				"Runtime and authenticated browser behavior may remain untested unless DAST/dynamic checks were run separately.",
		});
	}
	return risks;
}

function buildRecommendedNextActions(
	data: Awaited<ReturnType<typeof loadReportData>>,
	coverageGaps: Array<Record<string, unknown>>,
) {
	const actions: Array<Record<string, unknown>> = [];
	if (data.attackSurface.length === 0) {
		actions.push({
			command:
				"bun run inventory:attack-surface -- --project-id <project-id> --scan-run-id <scan-run-id>",
			reason: "Generate attack surface context for this scan.",
		});
	}
	if (data.checkResults.length === 0) {
		actions.push({
			command:
				"bun run check:security -- --project-id <project-id> --scan-run-id <scan-run-id>",
			reason:
				"Generate deterministic check results before relying on a zero-finding conclusion.",
		});
	}
	if (coverageGaps.length > 0) {
		actions.push({
			command: "Review manual_review and not_checked security check results.",
			reason:
				"Close diagnostic coverage gaps before treating the scan as low risk.",
		});
	}
	if (actions.length === 0) {
		actions.push({
			command:
				"Review the checked categories and decide whether DAST or dynamic verification is needed.",
			reason:
				"Static and diagnostic checks do not fully replace runtime validation.",
		});
	}
	return actions;
}

function buildMarkdown(input: {
	title: string;
	summary: string;
	project: Awaited<ReturnType<typeof loadReportData>>["project"];
	scanRun: Awaited<ReturnType<typeof loadReportData>>["scanRun"];
	toolRunRows: Awaited<ReturnType<typeof loadReportData>>["toolRunRows"];
	findingRows: Awaited<ReturnType<typeof loadReportData>>["findingRows"];
	attackSurface: Awaited<ReturnType<typeof loadReportData>>["attackSurface"];
	checkResults: Awaited<ReturnType<typeof loadReportData>>["checkResults"];
	checkedCategories: Array<Record<string, unknown>>;
	coverageGaps: Array<Record<string, unknown>>;
	residualRisks: Array<Record<string, unknown>>;
	recommendedNextActions: Array<Record<string, unknown>>;
}): string {
	const lines: string[] = [];
	lines.push(`# ${input.title}`);
	lines.push("");
	lines.push("## Result");
	lines.push(input.summary);
	lines.push("");
	lines.push(
		`Project: ${input.project.name} (${input.project.id})  \nScan: ${input.scanRun.id} / ${input.scanRun.profile} / ${input.scanRun.status}`,
	);
	lines.push("");
	lines.push("## Checked Categories");
	if (input.checkedCategories.length === 0) {
		lines.push("No diagnostic categories were checked.");
	} else {
		lines.push("| Category | Inventory Items | Check Results |");
		lines.push("| --- | ---: | ---: |");
		for (const row of input.checkedCategories) {
			lines.push(
				`| ${row.category ?? "unknown"} | ${row.inventory ?? 0} | ${row.checks ?? 0} |`,
			);
		}
	}
	lines.push("");
	lines.push("## Attack Surface Inventory");
	if (input.attackSurface.length === 0) {
		lines.push(
			"Attack Surface Inventory has not been generated for this scan.",
		);
	} else {
		lines.push("| Category | Kind | Name | Location | Confidence |");
		lines.push("| --- | --- | --- | --- | --- |");
		for (const item of input.attackSurface.slice(0, 50)) {
			const location =
				item.locationJson && typeof item.locationJson === "object"
					? (item.locationJson as Record<string, unknown>)
					: {};
			const loc = `${location.path ?? "unknown"}${
				location.line ? `:${location.line}` : ""
			}`;
			lines.push(
				`| ${item.category} | ${item.kind} | ${escapeCell(item.name)} | ${escapeCell(loc)} | ${item.confidence} |`,
			);
		}
	}
	lines.push("");
	lines.push("## Passed Checks");
	const passed = input.checkResults.filter(
		(result) => result.status === "pass",
	);
	if (passed.length === 0) {
		lines.push("No deterministic pass checks were recorded.");
	} else {
		for (const result of passed) {
			lines.push(`- ${result.title}: ${result.summary}`);
		}
	}
	lines.push("");
	lines.push("## Warnings and Manual Review");
	const reviewItems = input.checkResults.filter((result) =>
		["fail", "warn", "manual_review"].includes(result.status),
	);
	if (reviewItems.length === 0) {
		lines.push("No warning or manual-review check results were recorded.");
	} else {
		for (const result of reviewItems) {
			lines.push(`- [${result.status}] ${result.title}: ${result.summary}`);
		}
	}
	lines.push("");
	lines.push("## Coverage Gaps");
	if (input.coverageGaps.length === 0) {
		lines.push("No coverage gaps were recorded by the diagnostic framework.");
	} else {
		for (const gap of input.coverageGaps) {
			lines.push(`- ${gap.category ?? "unknown"}: ${gap.message ?? ""}`);
		}
	}
	lines.push("");
	lines.push("## Residual Risk");
	for (const risk of input.residualRisks) {
		lines.push(`- ${risk.category ?? "unknown"}: ${risk.message ?? ""}`);
	}
	lines.push("");
	lines.push("## Recommended Next Actions");
	for (const action of input.recommendedNextActions) {
		lines.push(
			`- ${action.command ?? "Review diagnostic context"}: ${action.reason ?? ""}`,
		);
	}
	lines.push("");
	lines.push(
		"This report does not claim that the project is safe. It describes checked evidence, unchecked areas, and residual risk for this scan.",
	);
	lines.push("");
	return lines.join("\n");
}

function escapeCell(value: unknown): string {
	return String(value ?? "N/A")
		.replace(/\|/g, "\\|")
		.replace(/\s+/g, " ");
}
