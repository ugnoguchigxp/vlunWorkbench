import { Link } from "@tanstack/react-router";
import { ChevronRight, Grid3X3, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type {
	fetchScanIntelligenceAgentQuery,
	ProjectStructureListResponse,
} from "../../api";
import { Button } from "../../ui";
import { Metric, StatusBadge } from "./project-detail-sections";
import {
	buildRiskMatrix,
	INTELLIGENCE_SEVERITIES,
} from "./project-intelligence-workspace-model";
import { StructureExplorer } from "./project-structure-panels";

type ResourceStatus = "idle" | "loading" | "loaded" | "failed";

export function IntelligenceLandscapePanel({
	projectId,
	scanRunId,
	exportPayload,
	structure,
	structureStatus,
	structureError,
	onReloadStructure,
	landscapeResult,
	landscapeStatus,
	landscapeError,
	onReloadLandscape,
}: {
	projectId: string;
	scanRunId: string;
	exportPayload: StaticIntelligenceExportV1;
	structure: ProjectStructureListResponse | null;
	structureStatus: ResourceStatus;
	structureError: string | null;
	onReloadStructure: () => void;
	landscapeResult: Awaited<
		ReturnType<typeof fetchScanIntelligenceAgentQuery>
	> | null;
	landscapeStatus: ResourceStatus;
	landscapeError: string | null;
	onReloadLandscape: () => void;
}) {
	const rows = useMemo(
		() => buildRiskMatrix(structure?.modules ?? [], exportPayload),
		[exportPayload, structure?.modules],
	);
	const [selectedRowId, setSelectedRowId] = useState(rows[0]?.id ?? null);
	useEffect(() => {
		if (selectedRowId && rows.some((row) => row.id === selectedRowId)) return;
		setSelectedRowId(rows[0]?.id ?? null);
	}, [rows, selectedRowId]);
	const landscape = landscapeResult?.bundles.landscape;
	const landscapePending = ["idle", "loading"].includes(landscapeStatus);
	const structurePending = ["idle", "loading"].includes(structureStatus);
	const selectedRow = structurePending
		? null
		: (rows.find((row) => row.id === selectedRowId) ?? null);
	const fallback =
		structureStatus === "failed" ||
		(structureStatus === "loaded" &&
			(!structure ||
				structure.status === "missing" ||
				structure.modules.length === 0));
	const structureBadge = structurePending
		? "loading"
		: fallback
			? "degraded"
			: (structure?.status ?? "missing");

	return (
		<div className="intelligence-panel-stack">
			<section className="projects-band intelligence-landscape-summary">
				<div className="projects-section-head">
					<div>
						<h2>リスク分布</h2>
						<p>
							{structurePending
								? "構造データを読み込んでいます。"
								: structureError
									? "構造データを取得できないため、ファイル単位で表示しています。"
									: fallback
										? "構造データがないため、ファイル単位で表示しています。"
										: "モジュール候補とFindingの関係を集計しています。"}
						</p>
					</div>
					<div className="project-section-actions">
						<StatusBadge status={structureBadge} />
						{structureError ? (
							<Button
								type="button"
								variant="secondary"
								onClick={onReloadStructure}
							>
								<RotateCcw className="icon" /> 構造を再試行
							</Button>
						) : null}
					</div>
				</div>
				<div className="project-metric-grid compact">
					<Metric
						label="Risk band"
						value={landscape?.risk.band ?? exportPayload.scanSummary.riskBand}
					/>
					<Metric
						label="Findings"
						value={
							landscape?.risk.findingCount ?? exportPayload.scan.findingCount
						}
					/>
					<Metric
						label={fallback ? "Files" : "Modules"}
						value={structurePending ? "…" : rows.length}
					/>
					<Metric
						label="Evidence"
						value={
							landscape?.evidence.quality ??
							exportPayload.scanSummary.evidenceQuality
						}
					/>
				</div>
			</section>

			<section className="projects-band intelligence-matrix-section">
				<div className="projects-section-head">
					<div>
						<h2>
							<Grid3X3 className="icon" /> Module × Severity
						</h2>
						<p>セルの数値は現在の生成物に含まれるFinding件数です。</p>
					</div>
				</div>
				{structurePending ? (
					<p role="status">構造データを読み込んでいます…</p>
				) : rows.length > 0 ? (
					<div className="intelligence-risk-matrix-wrap">
						<table className="intelligence-risk-matrix">
							<thead>
								<tr>
									<th scope="col">{fallback ? "File" : "Module"}</th>
									{INTELLIGENCE_SEVERITIES.map((severity) => (
										<th scope="col" key={severity}>
											{severity}
										</th>
									))}
									<th scope="col">Total</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr
										className={selectedRow?.id === row.id ? "selected" : ""}
										key={row.id}
									>
										<th scope="row">
											<button
												type="button"
												onClick={() => setSelectedRowId(row.id)}
											>
												<strong>{row.label}</strong>
												<small>{row.pathPrefix}</small>
											</button>
										</th>
										{INTELLIGENCE_SEVERITIES.map((severity) => (
											<td key={severity} className={`severity-${severity}`}>
												<button
													type="button"
													onClick={() => setSelectedRowId(row.id)}
													aria-label={`${row.label}の${severity} Finding ${row.counts[severity]}件`}
												>
													{row.counts[severity]}
												</button>
											</td>
										))}
										<td className="intelligence-matrix-total">{row.total}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="projects-empty compact">
						現在の生成物ではFindingを含むリスク分布を作成できません。
					</div>
				)}
				{!structurePending &&
				fallback &&
				rows.some((row) => row.approximate) ? (
					<p className="intelligence-muted">
						構造データが未生成のためファイル単位です。graphでseverityを解決できないFindingはunknownへ集計しています。
					</p>
				) : null}
			</section>

			{selectedRow ? (
				<section className="projects-band intelligence-landscape-detail">
					<div className="projects-section-head">
						<div>
							<span className="project-chip">選択中</span>
							<h2>{selectedRow.label}</h2>
							<p>{selectedRow.pathPrefix}</p>
						</div>
						{selectedRow.fileRefs[0] ? (
							<Link
								to="/projects/$projectId/intelligence"
								params={{ projectId }}
								search={{
									scanRunId,
									intelligenceView: "investigate",
									focusPath: selectedRow.fileRefs[0],
								}}
								className="project-open-link"
							>
								調査ビューで開く
								<ChevronRight className="icon" />
							</Link>
						) : null}
					</div>
					<div className="project-metric-grid compact">
						<Metric label="Files" value={selectedRow.fileRefs.length} />
						<Metric label="Findings" value={selectedRow.total} />
						<Metric label="Max severity" value={selectedRow.maxSeverity} />
					</div>
					<div className="project-chip-cloud">
						{selectedRow.fileRefs.map((path) => (
							<span className="project-chip" key={path}>
								{path}
							</span>
						))}
					</div>
				</section>
			) : null}

			<section
				className="projects-band intelligence-landscape-context"
				aria-busy={landscapePending}
			>
				<div className="projects-section-head">
					<div>
						<h2>Coverage / Evidence / Remediation</h2>
						<p>既存のread-only Agent bundleによる補足情報です。</p>
					</div>
					{landscapeError ? (
						<Button
							type="button"
							variant="secondary"
							onClick={onReloadLandscape}
						>
							<RotateCcw className="icon" /> 再試行
						</Button>
					) : null}
				</div>
				{landscape ? (
					<div className="intelligence-landscape-context-grid">
						<article>
							<span>Coverage</span>
							<strong>{landscape.coverage.status}</strong>
							<p>
								{landscape.coverage.scannedToolCount} tools ·{" "}
								{landscape.coverage.artifactCount} artifacts
							</p>
						</article>
						<article>
							<span>Evidence</span>
							<strong>{landscape.evidence.quality}</strong>
							<p>
								{landscape.evidence.missingEvidenceFindingIds.length} missing ·{" "}
								{landscape.evidence.weakEvidenceFindingIds.length} weak
							</p>
						</article>
						<article>
							<span>Remediation</span>
							<strong>{landscape.remediation.reviewStatus}</strong>
							<p>
								{landscape.remediation.acceptanceCriteriaCount} criteria ·{" "}
								{landscape.remediation.verificationCommandCount} commands
							</p>
						</article>
					</div>
				) : landscapePending ? (
					<p role="status">補足情報を読み込んでいます…</p>
				) : (
					<p
						className={
							landscapeError
								? "intelligence-inline-error"
								: "intelligence-muted"
						}
						role={landscapeError ? "alert" : undefined}
					>
						{landscapeError ??
							"補足情報はありません。上のリスク分布は引き続き利用できます。"}
					</p>
				)}
			</section>

			<details className="projects-band intelligence-structure-details">
				<summary>
					<strong>Structure Explorerの詳細</strong>
					<ChevronRight className="icon" />
				</summary>
				{structurePending ? (
					<p role="status">Structure Explorerを読み込んでいます…</p>
				) : (
					<>
						{structureError ? (
							<p className="intelligence-inline-error" role="alert">
								{structureError}
							</p>
						) : null}
						<StructureExplorer
							structure={structure}
							exportPayload={exportPayload}
						/>
					</>
				)}
			</details>
		</div>
	);
}
