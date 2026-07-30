import type { AppDatabase } from "../../db";
import type { createFindingGroupRenderer } from "./report-builder-findings";
import type { ReportBuilderOptions } from "./report-builder-helpers";
import {
	escapeTableCell,
	formatDateTime,
	reportHeading,
	toInlineText,
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
		allDastRuns,
		allDynamicRuns,
		allReproRuns,
		allReviews,
		deferredFindings,
		expectedDastSteps,
		falsePositiveFindings,
		latestAutomatedReview,
		rawFindings,
		scanRun,
		undecidedFindings,
		lines,
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
		"任意注釈なし Finding",
		undecidedFindings,
		options.includeUndecided,
	);

	lines.push("## LLM Criticality Assessment");
	lines.push(
		"この節は保存済み scanner finding、artifact-backed evidence、coverage、verification だけを入力にした自動評価です。scanner の事実、severity、status を変更するものではありません。",
	);
	if (latestAutomatedReview) {
		const { review, output } = latestAutomatedReview;
		lines.push(
			`- **Review ID:** ${review.id}`,
			`- **Provider / Model:** ${escapeTableCell(review.provider)} / ${escapeTableCell(review.model)}`,
			`- **Summary:** ${toInlineText(output.summary)}`,
			`- **Risk overview:** ${toInlineText(output.riskOverview)}`,
		);
		if (output.systemicRiskThemes.length > 0) {
			lines.push("- **Systemic risk themes:**");
			for (const theme of output.systemicRiskThemes) {
				lines.push(`  - ${toInlineText(theme)}`);
			}
		}
		if (output.limitations.length > 0) {
			lines.push("- **LLM assessment limitations:**");
			for (const limitation of output.limitations) {
				lines.push(`  - ${toInlineText(limitation)}`);
			}
		}
		lines.push("");
		lines.push(
			"| Finding ID | Criticality | Scanner severity | False-positive likelihood | Exploitability | Priority |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- |");
		const findingById = new Map(
			rawFindings.map((finding) => [finding.id, finding]),
		);
		for (const assessment of output.findingAssessments) {
			lines.push(
				`| ${assessment.findingId} | ${assessment.criticality} | ${escapeTableCell(findingById.get(assessment.findingId)?.severity ?? "unknown")} | ${assessment.falsePositiveLikelihood} | ${assessment.exploitability} | ${assessment.priority} |`,
			);
		}
		lines.push("");
		for (const assessment of output.findingAssessments) {
			lines.push(`### LLM assessment: ${assessment.findingId}`);
			lines.push(
				`- **Criticality rationale:** ${toInlineText(assessment.criticalityRationale)}`,
				`- **Business impact:** ${toInlineText(assessment.businessImpact)}`,
				`- **Remediation:** ${toInlineText(assessment.remediation)}`,
				`- **Evidence refs:** ${assessment.evidenceRefs.map((ref) => `${ref.kind}:${ref.id}`).join(", ")}`,
			);
			if (assessment.assumptions.length > 0) {
				lines.push(
					`- **Assumptions:** ${assessment.assumptions.map((item) => toInlineText(item)).join(" / ")}`,
				);
			}
			if (assessment.unknowns.length > 0) {
				lines.push(
					`- **Unknowns:** ${assessment.unknowns.map((item) => toInlineText(item)).join(" / ")}`,
				);
			}
			lines.push("");
		}
	} else {
		lines.push(
			"LLM assessment は利用できません。deterministic section と保存済み scanner 証跡は引き続き有効ですが、readiness では limitation として扱います。",
		);
		lines.push("");
	}

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
