import { buildScanCoverageReadModel } from "../coverage/scan-coverage-read-model";
import { readStoredScanExecutionPlan } from "../execution/scan-execution-plan-builder";
import {
	escapeTableCell,
	formatDateTime,
	formatSeverity,
	getLocationPath,
	readDiffReportContext,
	renderImprovementRequest,
	reportAlternateHeading,
	reportHeading,
	SEVERITIES,
	toInlineText,
} from "./report-builder-helpers";
import type { buildReportQuery } from "./report-builder-query";
import { readPluginExecutionSummary } from "./report-builder-technology";
import { scanProfileResolutionSchema } from "../../../../shared/schemas/scan-profile-catalog.schema";
import { professionalRunGroupAssessmentSchema } from "../../../../shared/schemas/professional-run-group.schema";

export function renderReportOverview(
	scope: Awaited<ReturnType<typeof buildReportQuery>>,
) {
	const {
		allDastRuns,
		allDastEvidence,
		allDynamicRuns,
		allReproRuns,
		coverageResults,
		decidedFindingCount,
		expectedDastSteps,
		includedFindings,
		latestImprovementRequest,
		processedFindings,
		profileSteps,
		project,
		rawFindings,
		reportTitle,
		reviewedFindingCount,
		scanRun,
		severityStats,
		stats,
	} = scope;

	// Start building Markdown content
	const lines: string[] = [];
	lines.push(`# ${reportTitle}`);
	lines.push("");

	// Scan Summary
	const metadataProfileOutcome = scanRun.metadata?.profileOutcome;
	const profileOutcome =
		(scanRun.profileOutcome !== "pending" && scanRun.profileOutcome) ||
		(typeof metadataProfileOutcome === "string"
			? metadataProfileOutcome
			: null) ||
		"N/A";
	const profileResolution = scanProfileResolutionSchema.safeParse(
		scanRun.metadata?.profileResolution,
	);
	const gateEvaluation =
		scanRun.metadata?.gateEvaluation &&
		typeof scanRun.metadata.gateEvaluation === "object"
			? (scanRun.metadata.gateEvaluation as Record<string, unknown>)
			: null;
	const diffContext = readDiffReportContext(scanRun.metadata);
	const technologySummary = readPluginExecutionSummary(scanRun.metadata);
	const coverage = buildScanCoverageReadModel({
		scanMetadata: scanRun.metadata,
		controls: coverageResults,
	});
	const sourceSastCoverage = coverage.sourceSast;
	const limitedSourceSast = sourceSastCoverage?.coverageEffect === "gap";
	const scanPreflight = coverage.preflight;
	const executionPlan = readStoredScanExecutionPlan(scanRun.metadata);
	const professionalRunGroupAssessment =
		professionalRunGroupAssessmentSchema.safeParse(
			scanRun.metadata?.professionalRunGroupAssessment,
		);
	const limitedPreflight =
		scanPreflight !== null && scanPreflight.status !== "ready";
	const limitedTechnology =
		technologySummary?.pluginResults.some(
			(result) =>
				result.coverageEffect !== "covered" || result.status !== "completed",
		) ?? false;
	const limitedDast =
		expectedDastSteps.length > 0 &&
		(allDastRuns.length === 0 ||
			allDastRuns.some(
				(run) =>
					run.coverageStatus !== "covered" ||
					!["findings", "no_findings_observed"].includes(
						run.verdict ?? "unknown_legacy",
					),
			));
	lines.push("## スキャン概要");
	lines.push(`- **プロジェクト名:** ${toInlineText(project.name)}`);
	lines.push(`- **スキャンプロファイル:** ${toInlineText(scanRun.profile)}`);
	lines.push(
		`- **プロファイル結果:** ${toInlineText(profileOutcome.toUpperCase())}`,
	);
	lines.push(`- **状態:** ${toInlineText(scanRun.status)}`);
	if (profileResolution.success) {
		lines.push(
			`- **Catalog profile:** requested=${toInlineText(profileResolution.data.requestedProfileId)}, canonical=${toInlineText(profileResolution.data.canonicalProfileId)}, execution=${toInlineText(profileResolution.data.executionProfileId ?? "none")}, policy=${toInlineText(profileResolution.data.resultPolicy)}`,
		);
	}
	if (gateEvaluation) {
		lines.push(
			`- **Gate decision:** ${toInlineText(String(gateEvaluation.gateDecision ?? "unknown"))}`,
		);
	}
	lines.push(`- **開始日時:** ${formatDateTime(scanRun.startedAt)}`);
	lines.push(`- **完了日時:** ${formatDateTime(scanRun.completedAt)}`);
	if (profileSteps.length > 0) {
		lines.push(
			`- **Profile steps:** ${profileSteps
				.map((step) =>
					step.kind === "dast"
						? `dast:${step.profileId}`
						: step.kind === "static_tool"
							? step.toolId
							: `${step.kind}:${step.adapter}`,
				)
				.join(", ")}`,
		);
	}
	if (sourceSastCoverage) {
		lines.push(
			`- **Source SAST coverage:** state=${sourceSastCoverage.state}, coverage=${sourceSastCoverage.coverageEffect}, engine=${sourceSastCoverage.engine ?? "not executed"}, ruleset=${sourceSastCoverage.rulesetId ?? "not executed"}`,
		);
		if (sourceSastCoverage.limitationCodes.length > 0) {
			lines.push(
				`- **Source SAST limitations:** ${sourceSastCoverage.limitationCodes.join(", ")}`,
			);
		}
	}
	if (scanPreflight) {
		lines.push(
			`- **Scan preflight:** status=${scanPreflight.status}, mode=${scanPreflight.mode}, binding=${scanPreflight.bindingHash}`,
		);
		if (scanPreflight.limitationCodes.length > 0) {
			lines.push(
				`- **Preflight limitations:** ${scanPreflight.limitationCodes.join(", ")}`,
			);
		}
	}
	if (executionPlan) {
		const applicable = executionPlan.steps.filter(
			(step) => step.applicability === "applicable",
		).length;
		const notApplicable = executionPlan.steps.filter(
			(step) => step.applicability === "not_applicable",
		).length;
		const blocked = executionPlan.steps.filter(
			(step) => step.readiness === "blocked",
		).length;
		lines.push(
			`- **Execution plan:** hash=${executionPlan.planHash}, strictness=${executionPlan.strictness}, applicable=${applicable}, not_applicable=${notApplicable}, blocked=${blocked}`,
		);
		if (executionPlan.blockerCodes.length > 0) {
			lines.push(
				`- **Execution plan blockers:** ${executionPlan.blockerCodes.join(", ")}`,
			);
		}
	}
	if (professionalRunGroupAssessment.success) {
		const assessment = professionalRunGroupAssessment.data;
		lines.push(
			`- **Professional run group:** technicalCompletion=${assessment.technicalCompletion}, humanApproval=${assessment.humanApproval}, blockingCapabilities=${assessment.blockingCapabilityIds.join(",") || "none"}, incompleteChildren=${assessment.incompleteChildIds.join(",") || "none"}, cleanupIncomplete=${assessment.cleanupIncompleteChildIds.join(",") || "none"}`,
		);
	}
	lines.push("");

	if (diffContext) {
		lines.push("## Diff Target and Coverage");
		lines.push(`- **Target kind:** ${diffContext.kind}`);
		lines.push(`- **Base SHA:** ${diffContext.baseSha}`);
		lines.push(`- **Head SHA:** ${diffContext.headSha ?? "working tree"}`);
		lines.push(`- **Merge base SHA:** ${diffContext.mergeBaseSha ?? "N/A"}`);
		lines.push(`- **Target digest:** ${diffContext.targetDigest}`);
		lines.push(
			`- **Path coverage:** changed=${diffContext.coverage.changed}, scannable=${diffContext.coverage.scannable}, deleted=${diffContext.coverage.deleted}, excluded=${diffContext.coverage.excluded}, unsupported=${diffContext.coverage.unsupported}, too_large=${diffContext.coverage.tooLarge}`,
		);
		lines.push(
			"- **V1 semantics:** changed path に関連するスキャンです。対象ファイルは whole-file で評価されるため、finding が変更行で新規に導入されたことを意味しません。",
		);
		if (diffContext.tools.length > 0) {
			lines.push(
				"| Tool | Applicability | Execution status | Reason | Coverage effect |",
			);
			lines.push("| --- | --- | --- | --- | --- |");
			for (const tool of diffContext.tools) {
				lines.push(
					`| ${escapeTableCell(tool.toolId)} | ${escapeTableCell(tool.applicability)} | ${escapeTableCell(tool.status ?? "-")} | ${escapeTableCell(tool.reasonCode ?? "-")} | ${escapeTableCell(tool.coverageEffect)} |`,
				);
			}
		}
		lines.push("");
	}

	lines.push("## 全体考察");
	if (rawFindings.length === 0) {
		if (diffContext?.coverage.changed === 0) {
			lines.push(
				"- **結論:** 差分対象に変更パスがなく、finding は生成されませんでした。これは脆弱性がないことを示す結果ではありません。",
			);
		} else if (diffContext?.coverage.scannable === 0) {
			lines.push(
				"- **結論:** 差分対象にスキャン可能なファイルがなく、finding は生成されませんでした。除外・削除・未対応ファイルを安全と判断した結果ではありません。",
			);
		} else if (
			diffContext?.tools.some(
				(tool) =>
					tool.applicability === "applicable" &&
					(tool.status === "failed" ||
						tool.status === "skipped" ||
						tool.coverageEffect === "gap"),
			)
		) {
			lines.push(
				"- **結論:** 差分対象のscanner実行が完了していないため、finding 0件を安全性の判断には使用できません。失敗または未実行のtoolを確認してください。",
			);
		} else if (limitedPreflight) {
			lines.push(
				"- **結論:** scanner/runtime preflight に blocked または未確認領域があるため、finding 0件を安全性判断には使用できません。preflight check と action code を確認してください。",
			);
		} else if (limitedSourceSast) {
			lines.push(
				"- **結論:** source SAST が実行されていないため、finding 0件をソースコードの安全性判断には使用できません。`source_sast_not_executed` は未確認領域として残ります。",
			);
		} else if (limitedDast) {
			lines.push(
				"- **結論:** DASTに未走査・通信失敗・認証失敗またはcoverage不明の領域があるため、finding 0件を合格や脆弱性不存在として扱えません。",
			);
		} else if (limitedTechnology) {
			lines.push(
				"- **結論:** 検出されたtechnology pluginに未実行、partial、またはgapの領域があるため、finding 0件を合格や脆弱性不存在として扱えません。",
			);
		} else {
			lines.push(
				"- **結論:** 今回のスキャン範囲では、対応が必要な指摘事項は発見されませんでした。",
			);
		}
		lines.push(
			"- この結論は、実行したプロファイル、対象範囲、ツール設定、取得済み artifact に基づくものです。未実行の観点やスキャン対象外のコードまで含めた完全な安全性を証明するものではありません。",
		);
		if (
			diffContext &&
			(diffContext.coverage.excluded > 0 ||
				diffContext.coverage.unsupported > 0 ||
				diffContext.coverage.tooLarge > 0)
		) {
			lines.push(
				`- **Diff coverage gaps:** excluded=${diffContext.coverage.excluded}, unsupported=${diffContext.coverage.unsupported}, too_large=${diffContext.coverage.tooLarge}。これらは未確認領域として残ります。`,
			);
		}
	} else {
		const urgentCount = severityStats.critical + severityStats.high;
		lines.push(
			`- 検出件数は ${rawFindings.length} 件で、このうち緊急または高 severity は ${urgentCount} 件です。まず high severity と証跡が弱い finding を、次の LLM が実装改善に進めるリスク文脈として渡してください。`,
		);
		lines.push(
			`- 任意の互換注釈は、実装改善候補 ${stats.needs_fix} 件、既知リスク記録 ${stats.accepted} 件、後続確認記録 ${stats.deferred} 件、誤検知 ${stats.false_positive} 件、注釈なし ${stats.undecided} 件です。この注釈の有無は自動診断やレポート生成を妨げません。`,
		);
		lines.push(
			`- finding 単位の追加レビュー済みは ${reviewedFindingCount} 件、任意注釈ありは ${decidedFindingCount} 件です。scan-level の自動 LLM 診断は、保存済み証跡と不足情報を明示して別節へ出力します。`,
		);
	}
	lines.push("");

	lines.push(reportHeading("executive-summary"));
	if (rawFindings.length === 0) {
		lines.push(
			"- **Risk posture:** informational。finding は 0 件ですが、自動診断ではスキャン範囲と診断カバレッジの制約を limitations として扱います。",
		);
	} else {
		const highestSeverity =
			SEVERITIES.find((severity) => severityStats[severity] > 0) ?? "unknown";
		const strongReviewCount = processedFindings.filter(
			(item) =>
				item.latestCompletedReview?.evidenceStrength?.level === "strong",
		).length;
		const weakOrMissingDecisionGradeEvidence = processedFindings.filter(
			(item) =>
				item.evidences.length === 0 ||
				item.latestCompletedReview?.evidenceStrength?.level === "weak" ||
				!item.latestCompletedReview,
		).length;
		lines.push(
			`- **Risk posture:** ${formatSeverity(highestSeverity)}。scanner finding ${rawFindings.length} 件、任意注釈なし ${stats.undecided} 件、既知リスク注釈 ${stats.accepted} 件です。`,
		);
		lines.push(
			`- **Evidence confidence:** strong review ${strongReviewCount} 件、weak/missing decision-grade evidence ${weakOrMissingDecisionGradeEvidence} 件です。`,
		);
		lines.push(
			"- **Recommended focus:** high severity、証跡が弱い finding の順に、自動 LLM 診断の criticality・影響・修正案を確認してください。",
		);
	}
	lines.push("");

	lines.push(reportHeading("risk-ranking"));
	if (rawFindings.length === 0) {
		lines.push(
			"Active findings are 0, so there is no finding-level risk ranking. Use the zero-finding coverage section to judge residual risk and unchecked scope.",
		);
	} else if (includedFindings.length === 0) {
		lines.push(
			"All findings are excluded by report options, so no finding-level risk ranking is included in this export.",
		);
	} else {
		lines.push(
			"| Rank | Finding ID | Severity | Implementation routing | Rationale |",
		);
		lines.push("| --- | --- | --- | --- | --- |");
		includedFindings.forEach((item, index) => {
			const reviewStrength =
				item.latestCompletedReview?.evidenceStrength?.level ?? "missing";
			lines.push(
				`| ${index + 1} | ${item.finding.id} | ${escapeTableCell(item.finding.severity)} | ${escapeTableCell(item.latestDecision?.decision ?? "undecided")} | ${escapeTableCell(`severity=${item.finding.severity}; evidence=${reviewStrength}`)} |`,
			);
		});
		if (stats.undecided > 0) {
			lines.push(
				`${stats.undecided} finding(s) have no optional compatibility annotation. This does not block the automated diagnosis or report.`,
			);
		}
	}
	lines.push("");

	lines.push(reportHeading("evidence-quality"));
	if (processedFindings.length === 0) {
		lines.push(
			"finding がないため、finding 単位の evidence quality はありません。",
		);
	} else if (includedFindings.length === 0) {
		lines.push(
			"レポート設定により、finding 単位の evidence quality は除外されています。",
		);
	} else {
		lines.push(
			"| Finding ID | Source/tool evidence | Review strength | Verification | Implementation routing |",
		);
		lines.push("| --- | --- | --- | --- | --- |");
		for (const item of includedFindings) {
			const fndRepros = allReproRuns.filter(
				(r) => r.findingId === item.finding.id,
			);
			const fndDynamics = allDynamicRuns.filter(
				(r) => r.findingId === item.finding.id,
			);
			const fndDastEv = allDastEvidence.filter(
				(e) => e.findingId === item.finding.id,
			);
			const locationPath = getLocationPath(item.finding.primaryLocation);
			const sourceOrTool =
				locationPath || item.evidences.length > 0 ? "present" : "missing";
			const verification =
				fndRepros.length > 0 || fndDynamics.length > 0 || fndDastEv.length > 0
					? "present"
					: "missing";
			lines.push(
				`| ${item.finding.id} | ${sourceOrTool} | ${escapeTableCell(item.latestCompletedReview?.evidenceStrength?.level ?? "missing")} | ${verification} | ${escapeTableCell(item.latestDecision?.decision ?? "undecided")} |`,
			);
		}
	}
	lines.push("");

	if (latestImprovementRequest) {
		lines.push(
			reportAlternateHeading("finding-decisions") ??
				"## LLM Implementation Handoff",
		);
		renderImprovementRequest(lines, latestImprovementRequest);
	} else {
		lines.push(reportHeading("finding-decisions"));
		lines.push("| Implementation routing | Count |");
		lines.push("| --- | --- |");
		lines.push(`| implementation_fix_candidate | ${stats.needs_fix} |`);
		lines.push(`| legacy_known_risk_record | ${stats.accepted} |`);
		lines.push(`| legacy_follow_up_record | ${stats.deferred} |`);
		lines.push(`| tool_noise_record | ${stats.false_positive} |`);
		lines.push(`| no_optional_annotation | ${stats.undecided} |`);
		if (stats.undecided > 0) {
			lines.push(
				"finding 単位の互換注釈は任意です。未入力でも、保存済み証跡に基づく自動 LLM 診断と統合レポートは生成されます。",
			);
		}
	}
	return { lines, diffContext };
}
