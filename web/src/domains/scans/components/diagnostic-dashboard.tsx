import {
	Activity,
	AlertTriangle,
	ClipboardCheck,
	FileText,
	Radar,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardAction } from "../diagnostic-dashboard";
import { formatSeverityLabel } from "../scan-display-copy";
import { useScans } from "../scans-context";
import { getSeverityClass } from "../scans-utils";

const severityLabels = ["critical", "high", "medium", "low", "info", "unknown"];

const blockerLabels: Record<string, string> = {
	no_scan_selected: "scan が選択されていません",
	scan_not_completed: "scan が未完了",
	missing_improvement_request: "改善依頼が不足",
	missing_diagnostic_summary_for_zero_findings:
		"finding 0 件の診断 summary が不足",
};

export function DiagnosticDashboard() {
	const c = useScans();
	const dashboard = c.diagnosticDashboard;
	const implementationRouting = dashboard.decisionProgress;
	const reports = dashboard.reportReadiness;
	const diagnostics = dashboard.diagnosticCoverage;

	return (
		<section className="diagnostic-dashboard" aria-label="診断ダッシュボード">
			<DashboardGroup
				title="検出結果"
				icon={<AlertTriangle className="icon" />}
			>
				<div className="diagnostic-severity-list">
					{severityLabels.map((severity) => (
						<span
							key={severity}
							className={`diagnostic-severity-chip ${getSeverityClass(severity)}`}
						>
							{formatSeverityLabel(severity)}
							<strong>{dashboard.severityCounts[severity] ?? 0}</strong>
						</span>
					))}
				</div>
				<Metric
					label="handoff 必要"
					value={`${implementationRouting.undecidedFindings} 件`}
				/>
			</DashboardGroup>

			<DashboardGroup
				title="実装ルーティング"
				icon={<ClipboardCheck className="icon" />}
			>
				<div className="diagnostic-progress-line">
					<span
						style={{
							width: progressWidth(
								implementationRouting.decidedFindings,
								implementationRouting.totalFindings,
							),
						}}
					/>
				</div>
				<div className="diagnostic-metric-grid">
					<Metric
						label="既存記録"
						value={`${implementationRouting.decidedFindings}/${implementationRouting.totalFindings}`}
					/>
					<Metric
						label="修正候補"
						value={String(implementationRouting.needsFix)}
					/>
					<Metric
						label="tool noise 記録"
						value={String(implementationRouting.falsePositive)}
					/>
					<Metric
						label="保留記録"
						value={String(implementationRouting.deferred)}
					/>
				</div>
			</DashboardGroup>

			<DashboardGroup title="診断" icon={<Radar className="icon" />}>
				<div className="diagnostic-metric-grid">
					<Metric
						label="攻撃面"
						value={String(diagnostics.attackSurfaceItems)}
					/>
					<Metric label="チェック" value={String(diagnostics.securityChecks)} />
					<Metric
						label="カバレッジギャップ"
						value={String(diagnostics.coverageGaps)}
					/>
					<Metric
						label="scan レビュー"
						value={String(dashboard.reviewCoverage.scanReviews)}
					/>
				</div>
				<div className="diagnostic-readiness">
					<FileText className="icon" />
					<span>
						{reportReadinessLabel(reports.ready, reports.scanReports)}
					</span>
				</div>
				{reports.blockers.length ? (
					<div className="diagnostic-blockers">
						{reports.blockers.map((blocker) => (
							<span key={blocker}>
								{blockerLabels[blocker] ?? blocker.replace(/_/g, " ")}
							</span>
						))}
					</div>
				) : null}
			</DashboardGroup>

			<DashboardGroup
				title="次のアクション"
				icon={<FileText className="icon" />}
			>
				<div className="diagnostic-action-list">
					{dashboard.nextActions.length ? (
						dashboard.nextActions.map((action) => (
							<button
								key={action.kind}
								type="button"
								className={`diagnostic-action-button priority-${action.priority}`}
								onClick={() => c.handleDashboardAction(action)}
							>
								<ActionIcon action={action} />
								<span>{action.label}</span>
							</button>
						))
					) : (
						<div className="diagnostic-empty-action">
							すぐに必要な操作はありません
						</div>
					)}
				</div>
			</DashboardGroup>
		</section>
	);
}

function DashboardGroup({
	children,
	icon,
	title,
}: {
	children: ReactNode;
	icon: ReactNode;
	title: string;
}) {
	return (
		<div className="diagnostic-dashboard-group">
			<div className="diagnostic-dashboard-group-title">
				{icon}
				<h2>{title}</h2>
			</div>
			{children}
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="diagnostic-metric">
			<small>{label}</small>
			<strong>{value}</strong>
		</div>
	);
}

function progressWidth(done: number, total: number): string {
	if (total <= 0) return "0%";
	return `${Math.min(100, Math.max(0, (done / total) * 100))}%`;
}

function reportReadinessLabel(ready: boolean, scanReports: number): string {
	if (scanReports > 0) return ready ? "レポート準備完了" : "レポートあり";
	return ready ? "生成可能" : "レポート生成ブロック中";
}

function ActionIcon({ action }: { action: DashboardAction }) {
	if (action.kind === "run_scan" || action.kind === "run_diagnostics")
		return <Activity className="icon" />;
	if (action.kind === "generate_report") return <FileText className="icon" />;
	if (
		action.kind === "create_improvement_request" ||
		action.kind === "review_findings"
	)
		return <ClipboardCheck className="icon" />;
	return <Radar className="icon" />;
}
