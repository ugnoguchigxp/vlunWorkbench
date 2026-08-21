import {
	buildRemediationFallback,
	codeFenceFor,
	describeEvidenceKinds,
	EVIDENCE_STRENGTH_LABELS,
	FALSE_POSITIVE_LABELS,
	formatDecision,
	formatSeverity,
	getLocationPath,
	getLocationStartLine,
	toInlineText,
} from "./report-builder-helpers";
import type { renderReportOverview } from "./report-builder-overview";
import type { buildReportQuery } from "./report-builder-query";

type Scope = Awaited<ReturnType<typeof buildReportQuery>> &
	ReturnType<typeof renderReportOverview>;
export function createFindingGroupRenderer(scope: Scope) {
	const {
		allArtifacts,
		allDastEvidence,
		allDynamicRuns,
		allReproRuns,
		sortedFindings,
		lines,
	} = scope;

	// Render a group of findings helper
	const renderFindingsGroup = (
		groupTitle: string,
		list: typeof sortedFindings,
		isIncluded: boolean,
	) => {
		lines.push(`## ${groupTitle}`);
		if (!isIncluded) {
			lines.push("レポート設定により、このセクションは除外されています。");
			lines.push("");
			return;
		}
		if (list.length === 0) {
			lines.push("この分類の finding はありません。");
			lines.push("");
			return;
		}

		for (const item of list) {
			const f = item.finding;
			const locationPath = getLocationPath(f.primaryLocation);
			const startLine = getLocationStartLine(f.primaryLocation) || 1;
			const locationText = locationPath
				? `${locationPath}:${startLine}`
				: "なし";
			const fndRepros = allReproRuns.filter((r) => r.findingId === f.id);
			const fndDynamics = allDynamicRuns.filter((r) => r.findingId === f.id);
			const fndDastEv = allDastEvidence.filter((e) => e.findingId === f.id);
			const review = item.latestCompletedReview;
			const evidenceKinds = describeEvidenceKinds(item.evidences);
			const remediation =
				toInlineText(review?.remediationDirection, "") ||
				buildRemediationFallback({
					bucket: item.bucket,
					severity: f.severity.toLowerCase(),
					locationPath,
				});
			const impact =
				toInlineText(review?.likelyImpact, "") ||
				`${formatSeverity(f.severity)} severity の検出です。${toInlineText(f.description)}`;
			const verificationNotes: string[] = [];
			if (fndRepros.length > 0) {
				verificationNotes.push(`sandbox reproduction ${fndRepros.length}件`);
			}
			if (fndDynamics.length > 0) {
				verificationNotes.push(`dynamic verification ${fndDynamics.length}件`);
			}
			if (fndDastEv.length > 0) {
				verificationNotes.push(`DAST evidence ${fndDastEv.length}件`);
			}

			lines.push(`### Finding ${f.id}`);
			lines.push(`- **タイトル:** ${toInlineText(f.title)}`);
			lines.push(`- **説明:** ${toInlineText(f.description)}`);
			lines.push(`- **検出ツール:** ${toInlineText(f.sourceTool)}`);
			lines.push(`- **ルールID:** ${toInlineText(f.ruleId)}`);
			lines.push(
				`- **Severity:** ${formatSeverity(f.severity)} (${toInlineText(f.severity)})`,
			);
			lines.push(`- **実装改善ルーティング:** ${formatDecision(item.bucket)}`);
			lines.push(
				`- **任意注釈の理由:** ${item.latestDecision ? toInlineText(item.latestDecision.reason) : "注釈なし"}`,
			);
			if (item.latestDecision?.comment) {
				lines.push(
					`- **互換記録コメント:** ${toInlineText(item.latestDecision.comment)}`,
				);
			}
			lines.push(`- **主な場所:** ${toInlineText(locationText)}`);
			lines.push("");

			lines.push("#### 考察");
			lines.push(
				`- **実装リスクの読み:** ${formatDecision(item.bucket)}として扱っています。${review ? "LLMレビュー結果と保存済み証跡をあわせて、実装改善に渡すリスク文脈を確認しています。" : "LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。"}`,
			);
			lines.push(`- **想定影響:** ${impact}`);
			lines.push(
				`- **根拠:** ${evidenceKinds}。主な場所は ${toInlineText(locationText)} です。`,
			);
			if (review?.falsePositiveAssessment) {
				lines.push(
					`- **誤検知の見立て:** ${FALSE_POSITIVE_LABELS[review.falsePositiveAssessment.level] ?? review.falsePositiveAssessment.level}。${toInlineText(review.falsePositiveAssessment.reasoning)}`,
				);
			}
			if (review?.evidenceStrength) {
				lines.push(
					`- **証跡の強さ:** ${EVIDENCE_STRENGTH_LABELS[review.evidenceStrength.level] ?? review.evidenceStrength.level}。${toInlineText(review.evidenceStrength.reasoning)}`,
				);
			}
			lines.push(`- **対応方針:** ${remediation}`);
			lines.push(
				`- **検証状況:** ${verificationNotes.length > 0 ? `${verificationNotes.join("、")} が記録されています。` : "再現・動的検証・DAST証跡はまだ記録されていません。"}`,
			);
			lines.push("");

			// Evidences
			lines.push("#### 証跡");
			if (item.evidences.length > 0) {
				for (const ev of item.evidences) {
					lines.push(`##### 証跡 ${ev.id}`);
					lines.push(`- **種別:** ${toInlineText(ev.kind)}`);
					lines.push(`- **タイトル:** ${toInlineText(ev.title)}`);
					if (ev.location) {
						lines.push(`- **場所:** ${JSON.stringify(ev.location)}`);
					}
					if (ev.artifactId) {
						lines.push(`- **アーティファクト参照:** ${ev.artifactId}`);
					}
					if (ev.snippet) {
						const fence = codeFenceFor(ev.snippet);
						lines.push("- **スニペット:**");
						lines.push(fence);
						lines.push(ev.snippet);
						lines.push(fence);
					}
					lines.push("");
				}
			} else {
				lines.push("証跡は記録されていません。");
				lines.push("");
			}

			// LLM Review
			lines.push("#### LLMレビュー");
			if (review) {
				const r = review;
				lines.push(`- **状態:** ${r.status}`);
				lines.push(`- **プロバイダー:** ${toInlineText(r.provider)}`);
				lines.push(`- **モデル:** ${toInlineText(r.model)}`);
				lines.push(`- **要約:** ${toInlineText(r.summary)}`);
				lines.push(`- **想定影響:** ${toInlineText(r.likelyImpact)}`);
				if (r.falsePositiveAssessment) {
					lines.push(
						`- **誤検知評価:** レベル: ${FALSE_POSITIVE_LABELS[r.falsePositiveAssessment.level] ?? toInlineText(r.falsePositiveAssessment.level)}, 理由: ${toInlineText(r.falsePositiveAssessment.reasoning)}`,
					);
				}
				if (r.evidenceStrength) {
					lines.push(
						`- **証跡強度:** レベル: ${EVIDENCE_STRENGTH_LABELS[r.evidenceStrength.level] ?? toInlineText(r.evidenceStrength.level)}, 理由: ${toInlineText(r.evidenceStrength.reasoning)}`,
					);
				}
				lines.push(`- **修正方向:** ${toInlineText(r.remediationDirection)}`);
				if (r.reviewerNotes && r.reviewerNotes.length > 0) {
					lines.push("- **レビューメモ:**");
					for (const note of r.reviewerNotes) {
						lines.push(`  - ${toInlineText(note)}`);
					}
				}
			} else {
				lines.push("- **状態:** 完了したレビューはありません。");
			}
			lines.push("");

			// Sandbox Reproduction
			lines.push("#### Sandbox Reproduction");
			if (fndRepros.length > 0) {
				for (const r of fndRepros) {
					lines.push(`- **Run ID:** ${r.id}`);
					lines.push(`  - **プロファイル:** ${toInlineText(r.profileId)}`);
					lines.push(`  - **状態:** ${toInlineText(r.status)}`);
					lines.push(`  - **結果:** ${toInlineText(r.outcome || "N/A")}`);
					if (r.summary) {
						lines.push(`  - **要約:** ${toInlineText(r.summary)}`);
					}
					if (r.errorMessage) {
						lines.push(`  - **エラー:** ${toInlineText(r.errorMessage)}`);
					}
				}
			} else {
				lines.push("sandbox reproduction は記録されていません。");
			}
			lines.push("");

			// Dynamic Verification
			lines.push("#### Dynamic Verification");
			if (fndDynamics.length > 0) {
				for (const r of fndDynamics) {
					lines.push(`- **Run ID:** ${r.id}`);
					lines.push(`  - **プロファイル:** ${toInlineText(r.profileId)}`);
					lines.push(`  - **種別:** ${toInlineText(r.dynamicKind)}`);
					lines.push(`  - **状態:** ${toInlineText(r.status)}`);
					lines.push(`  - **結果:** ${toInlineText(r.outcome || "N/A")}`);
					if (r.summary) {
						lines.push(`  - **要約:** ${toInlineText(r.summary)}`);
					}
					if (r.errorMessage) {
						lines.push(`  - **エラー:** ${toInlineText(r.errorMessage)}`);
					}
				}
			} else {
				lines.push("dynamic verification は記録されていません。");
			}
			lines.push("");

			// DAST Evidence
			lines.push("#### DAST証跡");
			if (fndDastEv.length > 0) {
				for (const ev of fndDastEv) {
					lines.push(`- **証跡ID:** ${ev.id}`);
					lines.push(`  - **Run ID:** ${ev.dastRunId}`);
					lines.push(`  - **種別:** ${toInlineText(ev.kind)}`);
					lines.push(`  - **タイトル:** ${toInlineText(ev.title)}`);
					if (ev.snippet) {
						lines.push(`  - **スニペット:** ${toInlineText(ev.snippet)}`);
					}
				}
			} else {
				lines.push("DAST証跡は記録されていません。");
			}
			lines.push("");

			// Raw Artifact references for finding
			const uniqueArtifactIds = Array.from(
				new Set(item.evidences.map((e) => e.artifactId).filter(Boolean)),
			) as string[];
			if (uniqueArtifactIds.length > 0) {
				lines.push("#### Raw Artifact参照");
				// Sort artifact references deterministically: kind, format, id
				const fndArtifacts = allArtifacts
					.filter((a) => uniqueArtifactIds.includes(a.id))
					.sort((a, b) => {
						const kindDiff = a.kind.localeCompare(b.kind);
						if (kindDiff !== 0) return kindDiff;
						const formatDiff = a.format.localeCompare(b.format);
						if (formatDiff !== 0) return formatDiff;
						return a.id.localeCompare(b.id);
					});
				for (const a of fndArtifacts) {
					lines.push(`- ${a.id} (${a.kind}/${a.format}): ${a.path}`);
				}
				lines.push("");
			}
		}
	};
	return { renderFindingsGroup };
}
