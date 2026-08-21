import type { DastCoverageSummary } from "../../../../shared/schemas/dast-coverage.schema";
import type { AppDatabase } from "../../../db";
import { buildGroupedFindings } from "../findings/grouping-builder";
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
import { renderTechnologyCoverage } from "./report-builder-technology";

type Scope = Awaited<ReturnType<typeof buildReportQuery>> &
	ReturnType<typeof renderReportOverview> &
	ReturnType<typeof createFindingGroupRenderer> & {
		db: AppDatabase;
		scanRunId: string;
		options: ReportBuilderOptions;
	};

function readDastCoverageSummary(
	value: DastCoverageSummary | Record<string, never>,
): DastCoverageSummary | null {
	return (
		typeof value.actionableKnownRouteCount === "number" &&
		typeof value.attemptedRouteCount === "number" &&
		typeof value.failedRouteCount === "number" &&
		typeof value.notTestedRouteCount === "number" &&
		typeof value.requestCount === "number" &&
		typeof value.budgetExhausted === "boolean"
			? value
			: null
	) as DastCoverageSummary | null;
}
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
		latestApplicationModel,
		latestBenchmarkMetrics,
		latestBenchmarkRun,
		latestThreatHypotheses,
		latestThreatModelRun,
		rawFindings,
		scanRun,
		scanBusinessLogicRuns,
		undecidedFindings,
		lines,
		renderFindingsGroup,
		db,
		scanRunId,
		options,
	} = scope;

	let groupedFindings: Awaited<ReturnType<typeof buildGroupedFindings>> | null =
		null;
	let groupingError: string | null = null;
	try {
		groupedFindings = await buildGroupedFindings(db, scanRunId);
	} catch (error) {
		groupingError = error instanceof Error ? error.message : String(error);
	}
	renderIssueGroups(lines, groupedFindings, groupingError);

	// Raw finding sections remain as an audit trail and preserve the existing
	// decision-oriented report structure. The issue section above is the primary
	// interpretation of duplicate scanner results.
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
		lines.push(
			"| Run ID | 対象Origin | プロファイル | 実行状態 | Verdict | Coverage | Legacy outcome |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- | --- |");
		const sortedDastRuns = [...allDastRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedDastRuns) {
			lines.push(
				`| ${r.id} | ${escapeTableCell(r.targetOrigin)} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.verdict ?? "unknown_legacy")} | ${escapeTableCell(r.coverageStatus ?? "gap")} | ${escapeTableCell(r.outcome || "-")} |`,
			);
			const coverage = readDastCoverageSummary(r.coverageSummary);
			lines.push("");
			lines.push(`### DAST scope and coverage: ${r.id}`);
			lines.push(
				`- **Verdict:** ${escapeTableCell(r.verdict ?? "unknown_legacy")}`,
			);
			lines.push(
				`- **Coverage:** ${escapeTableCell(r.coverageStatus ?? "gap")}`,
			);
			lines.push(
				`- **Policy:** ${escapeTableCell(r.policyId ?? "unknown")} (${escapeTableCell(r.policyHash ?? "hash unavailable")})`,
			);
			lines.push(
				`- **Known actionable routes:** ${coverage?.actionableKnownRouteCount ?? "unknown"}`,
			);
			lines.push(
				`- **Attempted routes:** ${coverage?.attemptedRouteCount ?? "unknown"}`,
			);
			lines.push(
				`- **Failed/not-tested routes:** ${coverage ? coverage.failedRouteCount + coverage.notTestedRouteCount : "unknown"}`,
			);
			lines.push(
				`- **Request budget:** used=${coverage?.requestCount ?? "unknown"}, exhausted=${coverage?.budgetExhausted ?? "unknown"}`,
			);
			lines.push(
				`- **Required seed coverage:** ${coverage?.requiredSeedCoverage ?? "unknown"}`,
			);
			lines.push(
				`- **Depth/auth/transport:** maxDepth=${coverage?.maxDepthReached ?? "unknown"}, authFailures=${coverage?.authFailureCount ?? "unknown"}, transportErrors=${coverage?.transportErrorCount ?? "unknown"}, timeouts=${coverage?.timeoutCount ?? "unknown"}`,
			);
			lines.push(
				`- **Limitations:** ${r.limitationCodes.length > 0 ? r.limitationCodes.map(escapeTableCell).join(", ") : "none recorded"}`,
			);
		}
		lines.push("");
		lines.push(
			"`no_findings_observed`は宣言済み範囲でfindingが観測されなかったことだけを示し、アプリケーション全体の脆弱性不存在を意味しません。",
		);
	} else {
		lines.push("このスキャンには DAST run が記録されていません。");
		if (expectedDastSteps.length > 0) {
			lines.push(
				"Runtime coverage gap: この ScanProfile は DAST を含みますが、DAST run は記録されていません。",
			);
		}
	}
	lines.push("");

	renderTechnologyCoverage(lines, scanRun.metadata);

	lines.push("## Measured Web/API Capability");
	lines.push(
		"- **Claim:** measured-automated-web-api-assessment-v1 = not_met unless a release evidence artifact references passing runs for every required corpus and the same release digests.",
	);
	lines.push(
		"- **Technology scope:** language、build system、frameworkの適用範囲は、上記のcurrent scan capability planを正とします。toolbox内にscanner dataが存在するだけではsupported claimに含めません。",
	);
	lines.push(
		"- **Unsupported/not tested:** WebSocket, GraphQL subscription, gRPC, SOAP, production active attack, arbitrary scanner scripts, network/cloud/AD/mobile/wireless/social-engineering.",
	);
	if (latestBenchmarkRun) {
		const overall = latestBenchmarkMetrics.find(
			(metric) => metric.category === "overall",
		);
		lines.push(
			`- **Latest benchmark:** ${latestBenchmarkRun.id} (${escapeTableCell(latestBenchmarkRun.corpusId)} ${escapeTableCell(latestBenchmarkRun.status)}), recall=${overall?.recall ?? "N/A"}, precision=${overall?.precision ?? "N/A"}, FPR=${overall?.falsePositiveRate ?? "N/A"}.`,
		);
	} else {
		lines.push(
			"- **Benchmark limitation:** no persisted external benchmark run is available.",
		);
	}
	lines.push("");

	lines.push("## Application Model and Threat Hypotheses");
	if (latestApplicationModel) {
		lines.push(
			`- **Application model snapshot:** ${latestApplicationModel.snapshotHash}`,
		);
	} else {
		lines.push("- **Application model:** not tested for this project.");
	}
	if (latestThreatModelRun) {
		const statusCounts = Object.fromEntries(
			[
				"hypothesis",
				"planned",
				"observed",
				"not_observed",
				"inconclusive",
				"not_tested",
			].map((status) => [
				status,
				latestThreatHypotheses.filter((item) => item.status === status).length,
			]),
		);
		lines.push(
			`- **Threat model run:** ${latestThreatModelRun.id} (${escapeTableCell(latestThreatModelRun.status)}; LLM available=${latestThreatModelRun.llmAvailable}).`,
			`- **Hypothesis status:** ${Object.entries(statusCounts)
				.map(([status, count]) => `${status}=${count}`)
				.join(", ")}.`,
		);
		if (latestThreatModelRun.limitations.length > 0)
			lines.push(
				`- **Threat-model limitations:** ${latestThreatModelRun.limitations.map((item) => toInlineText(item)).join(" / ")}`,
			);
	} else {
		lines.push(
			"- **Threat hypotheses:** not tested. Hypotheses are never counted as findings.",
		);
	}
	lines.push("");

	lines.push("## Business-Logic Control Coverage");
	if (scanBusinessLogicRuns.length > 0) {
		for (const status of [
			"observed",
			"inconclusive",
			"failed_cleanup",
			"not_observed",
			"not_tested",
		]) {
			const count = scanBusinessLogicRuns.filter(
				(run) => run.status === status,
			).length;
			if (count > 0) lines.push(`- **${status}:** ${count}`);
		}
		lines.push(
			"- Only `observed` runs with executable evidence can create a confirmed finding; inconclusive, failed cleanup, no-observation, and not-tested results are reported separately.",
		);
	} else {
		lines.push("- No business-logic scenario was executed for this scan.");
	}
	lines.push("");

	// Verification Metadata Section
	lines.push("## 検証メタデータ");
	lines.push(
		`- **レポート生成基準日時:** ${formatDateTime(scanRun.completedAt || scanRun.startedAt || scanRun.createdAt)}`,
	);
	lines.push(`- **Scan Run ID:** ${scanRunId}`);
	if (groupedFindings?.grouping) {
		lines.push(
			`- **Grouping snapshot:** run=${groupedFindings.grouping.runId ?? "unavailable"}, algorithm=${groupedFindings.grouping.algorithmVersion}, findingSetHash=${groupedFindings.grouping.findingSetHash ?? "unavailable"}, snapshotHash=${groupedFindings.grouping.snapshotHash ?? "unavailable"}`,
		);
	}
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
	if (groupedFindings) {
		if (groupedFindings.groups.length > 0) {
			lines.push(
				"| Issue ID | グループタイトル | 戦略 | Severity | 検出ツール | Raw finding件数 |",
			);
			lines.push("| --- | --- | --- | --- | --- | --- |");
			for (const g of groupedFindings.groups) {
				lines.push(
					`| ${g.id} | ${escapeTableCell(g.title)} | ${escapeTableCell(g.metadata.strategy)} | ${escapeTableCell(g.severity)} | ${escapeTableCell(g.sourceTools.join(", "))} | ${g.findingIds.length} |`,
				);
			}
		} else {
			lines.push("finding グループは記録されていません。");
		}
	} else {
		lines.push(
			`finding グループの生成に失敗しました: ${groupingError ?? "unknown error"}`,
		);
	}
	lines.push("");

	return lines.join("\n");
}

function renderIssueGroups(
	lines: string[],
	grouped: Awaited<ReturnType<typeof buildGroupedFindings>> | null,
	error: string | null,
): void {
	lines.push("## Issue Summary");
	if (!grouped) {
		lines.push(
			`Issue grouping は利用できません。raw finding 基準で表示します: ${error ?? "unknown error"}`,
		);
		lines.push("");
		return;
	}
	const { grouping, groups } = grouped;
	if (grouping) {
		lines.push(
			`- **Counts:** ${grouping.issueCount} issues / ${grouping.rawFindingCount} raw findings / ${grouping.suppressedCount} duplicates grouped`,
		);
		lines.push(`- **Grouping mode:** ${grouping.mode}`);
		if (grouping.limitations.length > 0) {
			lines.push(`- **Limitations:** ${grouping.limitations.join(", ")}`);
		}
	}
	if (groups.length === 0) {
		lines.push("このスキャンでは issue は検出されていません。");
		lines.push("");
		return;
	}
	lines.push("");
	lines.push("## Issue Findings");
	for (const group of groups) {
		const location = formatGroupLocation(group.primaryLocation);
		lines.push(`### [${group.severity.toUpperCase()}] ${group.title}`);
		lines.push(
			`- **Issue ID:** ${group.id}`,
			`- **Raw findings:** ${group.findingIds.length} (${group.findingIds.join(", ")})`,
			`- **Scanner signals:** ${group.sourceTools.join(", ")}`,
			`- **Location:** ${location || "not recorded"}`,
			`- **Grouping evidence:** ${group.reasonCodes.join(", ") || "singleton"} (${group.matchConfidence})`,
		);
		if (group.description.trim()) lines.push("", group.description.trim());
		lines.push("");
	}
}

function formatGroupLocation(location: Record<string, unknown>): string {
	const path = typeof location.path === "string" ? location.path : "";
	const line =
		typeof location.startLine === "number" ||
		typeof location.startLine === "string"
			? String(location.startLine)
			: "";
	return path ? (line ? `${path}:${line}` : path) : "";
}
