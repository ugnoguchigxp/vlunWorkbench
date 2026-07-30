import type { AppDatabase } from "../../db";
import type { createFindingGroupRenderer } from "./report-builder-findings";
import type { ReportBuilderOptions } from "./report-builder-helpers";
import {
	escapeTableCell,
	formatDateTime,
	reportHeading,
} from "./report-builder-helpers";
import type { renderReportOverview } from "./report-builder-overview";
import type { buildReportQuery } from "./report-builder-query";

type Scope = Awaited<ReturnType<typeof buildReportQuery>> &
	ReturnType<typeof renderReportOverview> &
	ReturnType<typeof createFindingGroupRenderer> & {
		db: AppDatabase;
		scanRunId: string;
		options: ReportBuilderOptions;
	};
export async function finalizeMarkdownReport(scope: Scope): Promise<string> {
	const {
		activeFindings,
		allArtifacts,
		allAttackSurfaceItems,
		allDastEvidence,
		allDastRuns,
		allDiagnosticReports,
		allDynamicRuns,
		allReproRuns,
		allReviews,
		allSecurityCheckResults,
		decidedFindingCount,
		deferredFindings,
		expectedDastSteps,
		failedOrMissingDastSteps,
		falsePositiveFindings,
		includedFindings,
		latestImprovementRequest,
		processedFindings,
		profileDefinition,
		profileSteps,
		project,
		rawFindings,
		reportTitle,
		reviewedFindingCount,
		scanRun,
		severityStats,
		sortedFindings,
		stats,
		stepResults,
		tools,
		undecidedFindings,
		lines,
		diffContext,
		renderFindingsGroup,
		db,
		scanRunId,
		options,
	} = scope;

	// 4. Render main sections
	renderFindingsGroup("実装改善候補・既知リスク Finding", activeFindings, true);
	renderFindingsGroup(
		"後続確認記録 Finding",
		deferredFindings,
		options.includeDeferred,
	);
	renderFindingsGroup(
		"誤検知 Finding",
		falsePositiveFindings,
		options.includeFalsePositives,
	);
	renderFindingsGroup(
		"LLM handoff未作成 Finding",
		undecidedFindings,
		options.includeUndecided,
	);

	// Sandbox Reproduction Summary Section
	lines.push("## Sandbox Reproduction サマリ");
	if (allReproRuns.length > 0) {
		lines.push(
			"| Run ID | Finding ID | プロファイル | 状態 | 結果 | 終了コード |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- |");
		const sortedReproRuns = [...allReproRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedReproRuns) {
			lines.push(
				`| ${r.id} | ${r.findingId} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} | ${r.exitCode ?? "-"} |`,
			);
		}
	} else {
		lines.push(
			"このスキャンには sandbox reproduction run が記録されていません。",
		);
	}
	lines.push("");

	// Dynamic Verification Summary Section
	lines.push("## Dynamic Verification サマリ");
	if (allDynamicRuns.length > 0) {
		lines.push(
			"| Run ID | Finding ID | プロファイル | 種別 | 状態 | 結果 | 終了コード |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- | --- |");
		const sortedDynRuns = [...allDynamicRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedDynRuns) {
			lines.push(
				`| ${r.id} | ${r.findingId || "-"} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.dynamicKind)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} | ${r.exitCode ?? "-"} |`,
			);
		}
	} else {
		lines.push(
			"このスキャンには dynamic verification run が記録されていません。",
		);
	}
	lines.push("");

	// DAST Summary Section
	lines.push("## DAST サマリ");
	if (allDastRuns.length > 0) {
		lines.push("| Run ID | 対象Origin | プロファイル | 状態 | 結果 |");
		lines.push("| --- | --- | --- | --- | --- |");
		const sortedDastRuns = [...allDastRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedDastRuns) {
			lines.push(
				`| ${r.id} | ${escapeTableCell(r.targetOrigin)} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} |`,
			);
		}
	} else {
		lines.push("このスキャンには DAST run が記録されていません。");
		if (expectedDastSteps.length > 0) {
			lines.push(
				"Runtime coverage gap: この ScanProfile は DAST を含みますが、DAST run は記録されていません。",
			);
		}
	}
	lines.push("");

	// Verification Metadata Section
	lines.push("## 検証メタデータ");
	lines.push(
		`- **レポート生成基準日時:** ${formatDateTime(scanRun.completedAt || scanRun.startedAt || scanRun.createdAt)}`,
	);
	lines.push(`- **Scan Run ID:** ${scanRunId}`);
	lines.push(`- **Drizzle Schema Version:** Phase 12 Hardened`);
	lines.push("");

	lines.push(reportHeading("appendix"));
	lines.push(
		"Report artifacts, LLM review references, and grouping snapshots.",
	);
	lines.push("");

	// Appendix: Raw Artifact References
	lines.push("### Raw Artifact References");
	if (allArtifacts.length > 0) {
		const sortedArtifacts = [...allArtifacts].sort((a, b) => {
			const kindDiff = a.kind.localeCompare(b.kind);
			if (kindDiff !== 0) return kindDiff;
			const formatDiff = a.format.localeCompare(b.format);
			if (formatDiff !== 0) return formatDiff;
			return a.id.localeCompare(b.id);
		});
		for (const a of sortedArtifacts) {
			lines.push(
				`- ID: ${a.id} (種別: ${a.kind}, 形式: ${a.format}, パス: ${a.path}, サイズ: ${a.sizeBytes} bytes, SHA256: ${a.sha256})`,
			);
		}
	} else {
		lines.push("このスキャンには artifact が記録されていません。");
	}
	lines.push("");

	// Appendix: Review References
	lines.push("### Review References");
	// Sort reviews deterministically: findingId, status, id
	const sortedReviews = [...allReviews].sort((a, b) => {
		const findingDiff = a.findingId.localeCompare(b.findingId);
		if (findingDiff !== 0) return findingDiff;
		const statusDiff = a.status.localeCompare(b.status);
		if (statusDiff !== 0) return statusDiff;
		return a.id.localeCompare(b.id);
	});
	if (sortedReviews.length > 0) {
		for (const r of sortedReviews) {
			lines.push(
				`- Finding ID: ${r.findingId} (Review ID: ${r.id}, Provider: ${r.provider}, Model: ${r.model}, Status: ${r.status})`,
			);
		}
	} else {
		lines.push("このスキャンには LLMレビューが記録されていません。");
	}
	lines.push("");

	// Appendix: Finding Groups Snapshot
	lines.push("### Finding Group Snapshot");
	try {
		const { buildGroupedFindings } = await import("./grouping-builder");
		const grouped = await buildGroupedFindings(db, scanRunId);
		if (grouped.groups.length > 0) {
			lines.push(
				"| グループタイトル | 戦略 | Severity | 検出ツール | Finding件数 |",
			);
			lines.push("| --- | --- | --- | --- | --- |");
			for (const g of grouped.groups) {
				lines.push(
					`| ${escapeTableCell(g.title)} | ${escapeTableCell(g.metadata.strategy)} | ${escapeTableCell(g.severity)} | ${escapeTableCell(g.sourceTools.join(", "))} | ${g.findingIds.length} |`,
				);
			}
		} else {
			lines.push("finding グループは記録されていません。");
		}
	} catch (err) {
		lines.push(
			`finding グループの生成に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	lines.push("");

	return lines.join("\n");
}
