import { coverageControlById } from "../../assessments/coverage-catalog";
import { buildScanCoverageReadModel } from "../coverage/scan-coverage-read-model";
import {
	buildRemediationFallback,
	escapeTableCell,
	getLocationPath,
	readRemediationMetadata,
	reportHeading,
	toInlineText,
} from "./report-builder-helpers";
import type { renderReportOverview } from "./report-builder-overview";
import type { buildReportQuery } from "./report-builder-query";

type Scope = Awaited<ReturnType<typeof buildReportQuery>> &
	ReturnType<typeof renderReportOverview> & { scanRunId: string };
export function renderReportCoverage(scope: Scope): void {
	const {
		allAttackSurfaceItems,
		allDastEvidence,
		allDiagnosticReports,
		allDynamicRuns,
		allReproRuns,
		allSecurityCheckResults,
		coverageResults,
		decidedFindingCount,
		failedOrMissingDastSteps,
		includedFindings,
		processedFindings,
		profileDefinition,
		profileSteps,
		project,
		rawFindings,
		reviewedFindingCount,
		scanRun,
		severityStats,
		stats,
		stepResults,
		tools,
		lines,
		diffContext,
		scanRunId,
	} = scope;

	lines.push("");

	lines.push("## Coverage and Limitations");
	lines.push(
		"finding 件数とは独立した control 単位の実行結果です。`not_tested`、`blocked`、`inconclusive` は成功として扱いません。",
	);
	const coverage = buildScanCoverageReadModel({
		scanMetadata: scanRun.metadata,
		controls: coverageResults,
	});
	const sourceSastCoverage = coverage.sourceSast;
	if (sourceSastCoverage) {
		lines.push(
			`- **Source SAST:** ${sourceSastCoverage.coverageEffect}; state=${sourceSastCoverage.state}; limitations=${sourceSastCoverage.limitationCodes.join(", ") || "none"}`,
		);
	}
	const scanPreflight = coverage.preflight;
	if (scanPreflight) {
		lines.push(
			`- **Preflight:** ${scanPreflight.status}; mode=${scanPreflight.mode}; checks=${scanPreflight.checks.length}; limitations=${scanPreflight.limitationCodes.join(", ") || "none"}`,
		);
		lines.push(
			"| Preflight step | Check | Required | Status | Reason | Action |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- |");
		for (const check of scanPreflight.checks) {
			lines.push(
				`| ${escapeTableCell(check.stepId)} | ${escapeTableCell(check.kind)} | ${check.required ? "yes" : "no"} | ${check.status} | ${escapeTableCell(check.reasonCode ?? "-")} | ${escapeTableCell(check.action ?? "-")} |`,
			);
		}
	}
	lines.push(
		"| Control | Framework | Category | Claim | Status | Method | Reason | Evidence |",
	);
	lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
	for (const result of coverage.controls) {
		const control = coverageControlById(result.controlId);
		lines.push(
			`| ${escapeTableCell(result.controlId)} | ${escapeTableCell(control ? `${control.framework} ${control.version}` : "unknown")} | ${escapeTableCell(control?.category ?? "unknown")} | ${escapeTableCell(control?.automationLevel ?? "unknown")} | ${escapeTableCell(result.status)} | ${escapeTableCell(result.method)} | ${escapeTableCell(result.reasonCode)} | ${result.evidenceRefs.length} |`,
		);
	}
	const partialControls = coverage.controls
		.map((result) => coverageControlById(result.controlId))
		.filter(
			(control): control is NonNullable<typeof control> =>
				control?.automationLevel === "partial",
		);
	if (partialControls.length > 0) {
		lines.push(
			"- **Automation claim:** `partial` controls can prove a detected violation, but a zero-finding run remains `inconclusive` and is never promoted to full control assurance.",
		);
		for (const control of partialControls) {
			lines.push(
				`  - ${control.id}: ${control.limitations.map((limitation) => toInlineText(limitation)).join(" ")}`,
			);
		}
	}
	const untested = coverage.controls.filter(
		(result) =>
			result.status === "not_tested" ||
			result.status === "blocked" ||
			result.status === "inconclusive" ||
			result.status === "unsupported",
	);
	if (untested.length > 0) {
		lines.push(
			`- **Residual coverage gaps:** ${untested.map((result) => `${result.controlId}:${result.status}`).join(", ")}`,
		);
	}
	lines.push("");

	lines.push(reportHeading("remediation-plan"));
	if (processedFindings.length === 0) {
		lines.push("修正計画が必要な finding はありません。");
	} else if (includedFindings.length === 0) {
		lines.push(
			"レポート設定により、finding 単位の remediation plan は除外されています。",
		);
	} else {
		lines.push(
			"| Finding ID | Status | Priority | Owner | Due date | Recommended fix |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- |");
		for (const item of includedFindings) {
			const remediation = readRemediationMetadata(item.latestDecision);
			const locationPath = getLocationPath(item.finding.primaryLocation);
			const fallback = buildRemediationFallback({
				bucket: item.bucket,
				severity: item.finding.severity.toLowerCase(),
				locationPath,
			});
			lines.push(
				`| ${item.finding.id} | ${escapeTableCell(remediation.status ?? item.bucket)} | ${escapeTableCell(remediation.priority ?? "-")} | ${escapeTableCell(remediation.owner ?? "-")} | ${escapeTableCell(remediation.dueDate ?? "-")} | ${escapeTableCell(remediation.recommendedFix || item.latestCompletedReview?.remediationDirection || fallback)} |`,
			);
		}
	}
	lines.push("");

	lines.push(reportHeading("verification-status"));
	const verificationEvidenceCount =
		allReproRuns.length + allDynamicRuns.length + allDastEvidence.length;
	if (processedFindings.length === 0) {
		lines.push(
			"finding がないため finding 単位の verification はありません。zero-finding coverage と diagnostic status を確認してください。",
		);
	} else {
		lines.push(
			`- **Verification evidence:** sandbox reproduction ${allReproRuns.length} 件、dynamic verification ${allDynamicRuns.length} 件、DAST evidence ${allDastEvidence.length} 件です。`,
		);
		lines.push(
			`- **Review coverage:** LLMレビュー済み ${reviewedFindingCount} 件、互換記録あり ${decidedFindingCount} 件、verification evidence あり ${verificationEvidenceCount} 件です。`,
		);
		if (verificationEvidenceCount === 0) {
			lines.push(
				"- **Partial reason:** 再現・動的検証・DAST 証跡がないため、実行時到達可能性の確認は partial です。",
			);
		}
	}
	lines.push("");

	lines.push(reportHeading("scan-comparison"));
	lines.push(
		"この Markdown builder は単一 scan run の保存済みデータから生成されます。baseline scan が UI/API から提供されていない場合、改善・悪化の差分は partial として扱ってください。",
	);
	lines.push("");

	lines.push(reportHeading("zero-finding-coverage"));
	if (rawFindings.length === 0) {
		lines.push(
			"finding 0 is not a proof of safety; it means no normalized findings were produced by the executed tools, profile, and scope.",
		);
		lines.push(
			"unexecuted checks and missing diagnostics remain residual risk, and this report describes what was checked and what was not checked.",
		);
		lines.push(
			`- **Scan scope:** project=${toInlineText(project.name)}, profile=${toInlineText(scanRun.profile)}, scanRun=${scanRunId}`,
		);
		if (diffContext) {
			lines.push(
				`- **Diff scope:** kind=${diffContext.kind}, changed=${diffContext.coverage.changed}, scannable=${diffContext.coverage.scannable}; whole-file V1 semantics apply.`,
			);
		}
		lines.push(
			`- **Tool execution summary:** ${tools.length} tool run(s), ${tools.filter((tool) => tool.status === "completed").length} completed.`,
		);
		lines.push(
			`- **Diagnostic report status:** ${allDiagnosticReports.length > 0 ? allDiagnosticReports.map((report) => `${report.reportKind}:${report.status}`).join(", ") : "missing"}`,
		);
		lines.push(
			`- **Attack surface inventory:** ${allAttackSurfaceItems.length} item(s).`,
		);
		lines.push(
			`- **Security checks:** ${allSecurityCheckResults.length} result(s); ${allSecurityCheckResults.filter((result) => result.status !== "pass").length} non-passing or incomplete.`,
		);
		if (allDiagnosticReports.length === 0) {
			lines.push(
				"- **Coverage limitation:** diagnostic report data is missing, so this report must not be read as a safety attestation.",
			);
		}
	} else {
		lines.push(
			"Findings are present, so zero-finding coverage is not the primary conclusion for this report. Residual risk is represented by the finding decisions, evidence quality, remediation, and verification sections.",
		);
	}
	lines.push("");

	// Tool Summary Table
	lines.push("## ツール実行サマリ");
	if (tools.length > 0) {
		const profileTools = profileDefinition?.tools ?? [];

		lines.push(
			"| ツール | 種別 | バージョン | 状態 | 終了コード | Scanner data | Reproducible |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- | --- |");
		// Sort tools deterministically
		const sortedTools = [...tools].sort((a, b) => {
			const nameDiff = a.toolName.localeCompare(b.toolName);
			if (nameDiff !== 0) return nameDiff;
			const createdA = a.createdAt ? a.createdAt.getTime() : 0;
			const createdB = b.createdAt ? b.createdAt.getTime() : 0;
			if (createdA !== createdB) return createdA - createdB;
			return a.id.localeCompare(b.id);
		});
		for (const t of sortedTools) {
			const profileTool = profileTools.find((pt) => pt.toolId === t.toolName);
			const requiredText = profileTool
				? profileTool.required
					? "必須"
					: "任意"
				: "N/A";
			const provenance =
				t.metadata?.provenance &&
				typeof t.metadata.provenance === "object" &&
				!Array.isArray(t.metadata.provenance)
					? (t.metadata.provenance as Record<string, unknown>)
					: {};
			lines.push(
				`| ${escapeTableCell(t.toolName)} | ${escapeTableCell(requiredText)} | ${escapeTableCell(t.toolVersion || "unknown")} | ${escapeTableCell(t.status)} | ${escapeTableCell(t.exitCode ?? "-")} | ${escapeTableCell(String(provenance.dataState ?? "unrecorded"))} / ${escapeTableCell(String(provenance.dataDigest ?? "-"))} | ${provenance.reproducible === true ? "yes" : "no"} |`,
			);
		}
	} else {
		lines.push("このスキャンで実行されたツールはありません。");
	}
	lines.push("");

	if (profileSteps.length > 0) {
		lines.push("## ScanProfile Step サマリ");
		lines.push("| Step | 種別 | 必須 | 状態 | 検出 | 補足 |");
		lines.push("| --- | --- | --- | --- | --- | --- |");
		for (const step of profileSteps) {
			const stepId =
				step.kind === "dast"
					? `dast:${step.profileId}`
					: step.kind === "static_tool"
						? step.toolId
						: `${step.kind}:${step.adapter}`;
			const result = stepResults.find((item) => {
				if (step.kind === "dast") {
					return item.kind === "dast" && item.profileId === step.profileId;
				}
				if (step.kind === "static_tool") {
					return item.kind === "static_tool" && item.toolId === step.toolId;
				}
				return item.kind === step.kind && item.stepId === stepId;
			});
			const status = (result?.status as string | undefined) ?? "skipped";
			const findingCount = (result?.findingCount as number | undefined) ?? 0;
			const note =
				step.kind === "dast"
					? ((result?.targetOrigin as string | undefined) ??
						(result?.error as string | undefined) ??
						"auto target")
					: step.kind === "api_schema_scan"
						? ((result?.reasonCode as string | undefined) ??
							(result?.error as string | undefined) ??
							"read-only operations; write_operations_not_scanned")
						: step.kind === "sbom_export"
							? ((result?.error as string | undefined) ??
								"inventory artifact; components are not findings")
							: ((result?.reasonCode as string | undefined) ??
								(result?.error as string | undefined) ??
								"-");
			lines.push(
				`| ${escapeTableCell(stepId)} | ${escapeTableCell(step.kind)} | ${step.required ? "yes" : "no"} | ${escapeTableCell(status)} | ${findingCount} | ${escapeTableCell(note)} |`,
			);
		}
		if (failedOrMissingDastSteps.length > 0) {
			lines.push(
				`Runtime coverage gap: expected DAST step(s) did not complete: ${failedOrMissingDastSteps
					.map((step) => `dast:${step.profileId}`)
					.join(", ")}.`,
			);
		}
		const coverageGaps = stepResults.filter(
			(item) =>
				item.coverageEffect === "gap" ||
				item.applicability === "not_applicable",
		);
		if (coverageGaps.length > 0) {
			lines.push("### Coverage gaps");
			for (const gap of coverageGaps) {
				lines.push(
					`- ${escapeTableCell(String(gap.stepId ?? gap.toolId ?? gap.kind))}: ${escapeTableCell(String(gap.reasonCode ?? gap.error ?? "coverage gap"))}`,
				);
			}
			lines.push(
				"Finding 0 件は、未実行・適用不能・認証要求を含む coverage gap と分けて解釈してください。",
			);
		}
		lines.push("");
	}

	// Legacy compatibility summary
	lines.push("## 実装改善ルーティングサマリ");
	lines.push("| ルーティング | 件数 |");
	lines.push("| --- | --- |");
	lines.push(`| 実装改善候補 | ${stats.needs_fix} |`);
	lines.push(`| 既知リスク記録 | ${stats.accepted} |`);
	lines.push(`| 後続確認記録 | ${stats.deferred} |`);
	lines.push(`| 誤検知 | ${stats.false_positive} |`);
	lines.push(`| 任意注釈なし | ${stats.undecided} |`);
	lines.push(`| **合計** | ${rawFindings.length} |`);
	lines.push("");

	lines.push("## Severity サマリ");
	lines.push("| Severity | 件数 |");
	lines.push("| --- | --- |");
	lines.push(`| 緊急 | ${severityStats.critical} |`);
	lines.push(`| 高 | ${severityStats.high} |`);
	lines.push(`| 中 | ${severityStats.medium} |`);
	lines.push(`| 低 | ${severityStats.low} |`);
	lines.push(`| 情報 | ${severityStats.info} |`);
	lines.push(`| 不明 | ${severityStats.unknown} |`);
	lines.push("");
}
