import { ArrowRight, CheckCircle2, ListChecks } from "lucide-react";
import { useState } from "react";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";
import { type ActionQueueState, actionQueueStateLabel } from "../work-states";

const filters = [
	{ value: "active", label: "未完了" },
	{ value: "all", label: "すべて" },
	{ value: "needs_review", label: "LLM文脈待ち" },
	{ value: "needs_verification", label: "検証推奨" },
	{ value: "ready_for_report", label: "レポート可能" },
	{ value: "blocked_by_evidence", label: "証跡不足" },
] as const;

const actionLabel: Record<ActionQueueState, string> = {
	scan_failed: "確認",
	needs_review: "LLM生成",
	needs_verification: "検証",
	blocked_by_evidence: "確認",
	ready_for_report: "作成",
	report_generated: "開く",
	zero_finding_needs_coverage: "確認",
};

const priorityLabel = {
	high: "高",
	medium: "中",
	low: "低",
};

export function ActionQueuePanel() {
	const c = useScans();
	const [visibleCount, setVisibleCount] = useState(8);
	const items = c.filteredActionQueueItems.slice(0, visibleCount);
	const hiddenCount = Math.max(
		0,
		c.filteredActionQueueItems.length - items.length,
	);

	return (
		<section
			className="action-queue-panel"
			aria-labelledby="action-queue-title"
		>
			<div className="action-queue-head">
				<div>
					<h2 id="action-queue-title">
						<ListChecks className="icon" />
						アクションキュー
					</h2>
					<small>
						{
							c.actionQueueItems.filter(
								(item) => item.state !== "report_generated",
							).length
						}{" "}
						件未完了 / 全 {c.actionQueueItems.length} 件
					</small>
				</div>
			</div>
			<div
				className="action-queue-filters"
				role="tablist"
				aria-label="アクションキューの絞り込み"
			>
				{filters.map((filter) => (
					<button
						type="button"
						key={filter.value}
						className={c.actionQueueFilter === filter.value ? "active" : ""}
						onClick={() => {
							c.setActionQueueFilter(filter.value);
							setVisibleCount(8);
						}}
					>
						{filter.label}
					</button>
				))}
			</div>
			{items.length > 0 ? (
				<div className="action-queue-list">
					{items.map((item) => (
						<button
							type="button"
							key={item.id}
							className={`action-queue-item priority-${item.priority}`}
							onClick={() => c.handleActionQueueItem(item)}
						>
							<span
								className={`action-priority-badge priority-${item.priority}`}
							>
								優先度 {priorityLabel[item.priority]}
							</span>
							<span className="action-queue-copy">
								<strong>{item.label}</strong>
								<small>{item.reason}</small>
								<span className="action-queue-meta">
									<span>{actionQueueStateLabel(item.state)}</span>
									{item.targetSummary ? (
										<span>{item.targetSummary}</span>
									) : null}
									<span>{formatDateTime(item.updatedAt)}</span>
								</span>
							</span>
							<span className="action-queue-command">
								{actionLabel[item.state]}
								<ArrowRight className="icon" />
							</span>
						</button>
					))}
					{hiddenCount > 0 ? (
						<button
							type="button"
							className="action-queue-show-all"
							onClick={() => setVisibleCount(c.filteredActionQueueItems.length)}
						>
							さらに {hiddenCount} 件を表示
						</button>
					) : null}
				</div>
			) : (
				<div className="action-queue-empty">
					<CheckCircle2 className="icon" />
					<span>この条件に一致するキュー項目はありません。</span>
				</div>
			)}
		</section>
	);
}
