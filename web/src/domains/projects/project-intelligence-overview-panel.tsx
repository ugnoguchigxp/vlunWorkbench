import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	CheckCircle2,
	ChevronRight,
	RotateCcw,
} from "lucide-react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type {
	ProjectIntelligenceView,
	ProjectStructureSummaryResponse,
} from "../../api";
import { Button } from "../../ui";
import { Metric, StatusBadge } from "./project-detail-sections";
import {
	buildStructureMetrics,
	sortModuleCandidates,
} from "./project-intelligence-structure-model";
import type { IntelligenceResourceStatus } from "./use-intelligence-structure-data";

export function IntelligenceOverviewPanel({
	projectId,
	scanRunId,
	view,
	exportPayload,
	structure,
	structureStatus,
	structureError,
	onReload,
}: {
	projectId: string;
	scanRunId: string;
	view: ProjectIntelligenceView;
	exportPayload: StaticIntelligenceExportV1;
	structure: ProjectStructureSummaryResponse | null;
	structureStatus: IntelligenceResourceStatus;
	structureError: string | null;
	onReload: () => void;
}) {
	const metrics = buildStructureMetrics(structure, exportPayload);
	const modules = sortModuleCandidates(structure?.modules ?? []).slice(0, 6);
	const pending = structureStatus === "idle" || structureStatus === "loading";
	const failed = structureStatus === "failed" && !structure;
	const degraded =
		structure?.status === "degraded" ||
		structure?.readiness?.resolution.status === "degraded" ||
		structure?.readiness?.moduleInference.status === "degraded";
	const calloutTone = failed ? "danger" : degraded ? "warning" : "success";
	const calloutTitle = failed
		? "プロジェクト構造を取得できません"
		: degraded
			? "一部制約付きでプロジェクト構造を利用できます"
			: pending
				? "プロジェクト構造を読み込んでいます"
				: "プロジェクト構造を利用できます";

	return (
		<div className="intelligence-panel-stack">
			<section className={`intelligence-overview-callout tone-${calloutTone}`}>
				{failed || degraded ? (
					<AlertTriangle className="icon" />
				) : (
					<CheckCircle2 className="icon" />
				)}
				<div>
					<span>Structure readiness</span>
					<h2>{calloutTitle}</h2>
					<p>
						検出事項の有無とは独立して、ファイル、モジュール候補、参照関係を確認できます。
					</p>
				</div>
				{structureError ? (
					<Button type="button" variant="secondary" onClick={onReload}>
						<RotateCcw className="icon" /> 再試行
					</Button>
				) : null}
			</section>

			<section className="projects-band">
				<div className="projects-section-head">
					<div>
						<h2>構造サマリー</h2>
						<p>永続化されたProject Structure Snapshotの集計です。</p>
					</div>
					<StatusBadge
						status={pending ? "loading" : (structure?.status ?? "missing")}
					/>
				</div>
				<div className="intelligence-structure-metrics">
					<Metric
						label="Inventory files"
						value={pending ? "…" : (metrics.inventoryFiles ?? "未生成")}
					/>
					<Metric
						label="Analyzed files"
						value={pending ? "…" : (metrics.analyzedFiles ?? "未生成")}
					/>
					<Metric
						label="Module candidates"
						value={pending ? "…" : metrics.modules}
					/>
					<Metric
						label="Resolved refs"
						value={pending ? "…" : (metrics.resolvedReferences ?? "未生成")}
					/>
					<Metric
						label="Entrypoints"
						value={pending ? "…" : metrics.entrypoints}
					/>
					<Metric label="Packages" value={pending ? "…" : metrics.packages} />
				</div>
			</section>

			<section className="projects-band">
				<div className="projects-section-head">
					<div>
						<h2>主要なモジュール候補</h2>
						<p>
							ファイル数の多い候補から表示しています。正式なOntology
							nodeではありません。
						</p>
					</div>
					<Link
						to="/projects/$projectId/intelligence"
						params={{ projectId }}
						search={{ scanRunId, intelligenceView: "modules" }}
						className="project-open-link"
					>
						すべて見る <ChevronRight className="icon" />
					</Link>
				</div>
				{pending ? (
					<p role="status">モジュール候補を読み込んでいます…</p>
				) : modules.length > 0 ? (
					<div className="intelligence-module-card-grid">
						{modules.map((module) => (
							<Link
								key={module.id}
								to="/projects/$projectId/intelligence"
								params={{ projectId }}
								search={{
									scanRunId,
									intelligenceView: "modules",
									moduleId: module.id,
								}}
							>
								<strong>{module.label}</strong>
								<span>{module.pathPrefix}</span>
								<small>
									{module.fileCount} files · {module.entrypointFiles.length}{" "}
									entrypoints · confidence {module.confidence.toFixed(2)}
								</small>
							</Link>
						))}
					</div>
				) : (
					<div className="projects-empty compact">
						モジュール候補は生成されていません。
					</div>
				)}
			</section>

			<section className="intelligence-overview-lower-grid">
				<article className="projects-band">
					<div className="projects-section-head">
						<div>
							<h2>解析カバレッジ</h2>
							<p>未解析と未解決を0件として扱いません。</p>
						</div>
					</div>
					<dl className="intelligence-definition-list">
						<dt>Discovered</dt>
						<dd>{structure?.coverage?.discoveredFileCount ?? "未生成"}</dd>
						<dt>Unsupported</dt>
						<dd>{structure?.coverage?.unsupportedFileCount ?? "未生成"}</dd>
						<dt>Unresolved refs</dt>
						<dd>{metrics.unresolvedReferences ?? "未生成"}</dd>
						<dt>Diagnostics</dt>
						<dd>{structure?.diagnostics?.length ?? "未生成"}</dd>
					</dl>
				</article>
				<article className="projects-band">
					<div className="projects-section-head">
						<div>
							<h2>セキュリティ証跡の重ね合わせ</h2>
							<p>Scanの結果を構造情報へ関連付けた補助情報です。</p>
						</div>
					</div>
					<div className="project-metric-grid compact">
						<Metric label="検出事項" value={metrics.findings} />
						<Metric label="Risk" value={exportPayload.scanSummary.riskBand} />
						<Metric
							label="Evidence"
							value={exportPayload.scanSummary.evidenceQuality}
						/>
					</div>
					<p className="intelligence-muted">
						{metrics.findings === 0
							? "このgenerationには検出事項のoverlayがありません。構造解析結果は引き続き利用できます。"
							: "個別の検出内容と判定はScan Workspaceで確認します。"}
					</p>
				</article>
			</section>

			{view.degradedReasons.length > 0 ? (
				<section className="projects-band" role="status">
					<h2>Generation constraints</h2>
					<ul>
						{view.degradedReasons.map((reason) => (
							<li key={reason}>{reason}</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
