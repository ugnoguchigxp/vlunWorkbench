import { Link } from "@tanstack/react-router";
import {
	CheckCircle2,
	ChevronRight,
	CircleDashed,
	RotateCcw,
} from "lucide-react";
import type { DiagnosticEvidenceGraph } from "../../../../shared/schemas/static-intelligence.schema";
import type { Finding } from "../../api";
import { Button } from "../../ui";
import { formatDateTime } from "../scans/scans-utils";
import { formatFindingLocation } from "./project-intelligence-workspace-model";
import type { FindingDetail } from "./use-intelligence-workspace-data";

const DECISION_LABELS = {
	accepted: "既知リスク記録",
	false_positive: "誤検知記録",
	deferred: "保留記録",
	needs_fix: "実装改善候補",
} as const;

export function IntelligenceFindingDetail({
	projectId,
	scanRunId,
	finding,
	detail,
	status,
	error,
	graph,
	onRetry,
}: {
	projectId: string;
	scanRunId: string;
	finding: Finding | null;
	detail: FindingDetail | null;
	status: "idle" | "loading" | "loaded" | "failed";
	error: string | null;
	graph?: DiagnosticEvidenceGraph;
	onRetry: () => void;
}) {
	if (!finding && status === "loading") {
		return (
			<div className="projects-empty intelligence-detail-empty" role="status">
				Finding詳細を読み込んでいます…
			</div>
		);
	}
	if (!finding) {
		return (
			<div className="projects-empty intelligence-detail-empty">
				<h2>Findingを選択してください</h2>
				<p>左側のファイルとFindingを選ぶと詳細を表示します。</p>
			</div>
		);
	}
	if (!detail && ["idle", "loading"].includes(status)) {
		return (
			<div className="projects-empty intelligence-detail-empty" role="status">
				Finding詳細を読み込んでいます…
			</div>
		);
	}
	if (!detail && error) {
		return (
			<div className="projects-empty intelligence-detail-empty" role="alert">
				<strong>{error}</strong>
				<Button type="button" variant="secondary" onClick={onRetry}>
					<RotateCcw className="icon" />
					再試行
				</Button>
			</div>
		);
	}
	const shown = detail?.finding ?? finding;
	const findingNode = graph?.nodes.find(
		(node) =>
			node.kind === "finding" &&
			(node.sourceId === shown.id || node.id === shown.id),
	);
	const relatedEdges = findingNode
		? (graph?.edges.filter(
				(edge) => edge.from === findingNode.id || edge.to === findingNode.id,
			) ?? [])
		: [];
	return (
		<article
			className="intelligence-finding-detail"
			aria-busy={status === "loading"}
		>
			<header>
				<div>
					<span className={`project-chip severity-${shown.severity}`}>
						{shown.severity}
					</span>
					<h2>{shown.title}</h2>
					<p>{formatFindingLocation(shown)}</p>
				</div>
				<Link
					to="/scans"
					search={{ projectId, scanRunId }}
					className="project-open-link"
				>
					Scan Workspace
					<ChevronRight className="icon" />
				</Link>
			</header>
			<div className="intelligence-finding-summary">
				<div>
					<span>Rule</span>
					<strong>{shown.ruleId}</strong>
				</div>
				<div>
					<span>Scanner</span>
					<strong>{shown.sourceTool}</strong>
				</div>
				<div>
					<span>Status</span>
					<strong>{shown.status}</strong>
				</div>
			</div>
			<section className="intelligence-detail-section">
				<h3>内容</h3>
				<p>{shown.description || "説明はありません。"}</p>
			</section>
			<section className="intelligence-detail-section">
				<div className="intelligence-section-title-row">
					<h3>Evidence</h3>
					<span>{detail?.evidence.length ?? 0}件</span>
				</div>
				{detail?.evidence.length ? (
					<div className="intelligence-evidence-list">
						{detail.evidence.map((evidence) => (
							<article key={evidence.id}>
								<CheckCircle2 className="icon" />
								<div>
									<strong>{evidence.title}</strong>
									<small>{evidence.kind}</small>
									{evidence.snippet ? <pre>{evidence.snippet}</pre> : null}
								</div>
							</article>
						))}
					</div>
				) : (
					<p className="intelligence-muted">
						このFindingに紐づくEvidenceは現在の取得結果にありません。
					</p>
				)}
			</section>
			{relatedEdges.length > 0 ? (
				<section className="intelligence-detail-section">
					<h3>Evidence Graph context</h3>
					<ul className="intelligence-edge-list">
						{relatedEdges.slice(0, 8).map((edge) => (
							<li key={edge.id}>
								<code>{edge.kind}</code> {edge.from} → {edge.to}
							</li>
						))}
					</ul>
				</section>
			) : null}
			<section className="intelligence-detail-section intelligence-review-grid">
				<div>
					<h3>最新レビュー</h3>
					{detail?.latestReview ? (
						<>
							<strong>
								{detail.latestReview.summary ?? detail.latestReview.status}
							</strong>
							<p>
								{detail.latestReview.likelyImpact ??
									"Impactの記録はありません。"}
							</p>
							<small>{formatDateTime(detail.latestReview.createdAt)}</small>
						</>
					) : (
						<p className="intelligence-muted">レビュー記録はありません。</p>
					)}
				</div>
				<div>
					<h3>最新の互換Decision</h3>
					{detail?.latestDecision ? (
						<>
							<strong>{DECISION_LABELS[detail.latestDecision.decision]}</strong>
							<p>{detail.latestDecision.reason}</p>
							<small>{formatDateTime(detail.latestDecision.createdAt)}</small>
						</>
					) : (
						<p className="intelligence-muted">
							<CircleDashed className="icon" /> 未記録
						</p>
					)}
				</div>
			</section>
		</article>
	);
}
