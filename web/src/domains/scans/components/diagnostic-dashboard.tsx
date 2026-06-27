import {
	Activity,
	AlertTriangle,
	ClipboardCheck,
	FileText,
	Radar,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardAction } from "../diagnostic-dashboard";
import { formatScanOutcome } from "../scan-profile-display";
import { useScans } from "../scans-context";
import { formatDateTime, getSeverityClass } from "../scans-utils";

const severityLabels = ["critical", "high", "medium", "low", "info", "unknown"];

export function DiagnosticDashboard() {
	const c = useScans();
	const dashboard = c.diagnosticDashboard;
	const latest = dashboard.latestScanRun;
	const decisions = dashboard.decisionProgress;
	const reports = dashboard.reportReadiness;
	const diagnostics = dashboard.diagnosticCoverage;

	return (
		<section className="diagnostic-dashboard" aria-label="Diagnostic dashboard">
			<DashboardGroup title="Latest Scan" icon={<Activity className="icon" />}>
				<div className="diagnostic-primary-row">
					<strong>{latest?.profile ?? "No scan"}</strong>
					<span
						className={`scan-status-badge badge-${latest?.status ?? "unknown"}`}
					>
						{formatScanOutcome(latest?.status)}
					</span>
				</div>
				<div className="diagnostic-metric-grid two">
					<Metric
						label="Findings"
						value={
							latest?.findingCountKnown ? String(latest.findingCount) : "-"
						}
					/>
					<Metric
						label="Completed"
						value={formatDateTime(latest?.completedAt)}
					/>
				</div>
				<small>
					{latest
						? formatDateTime(latest.createdAt)
						: "Project has no saved scan."}
				</small>
			</DashboardGroup>

			<DashboardGroup
				title="Findings"
				icon={<AlertTriangle className="icon" />}
			>
				<div className="diagnostic-severity-list">
					{severityLabels.map((severity) => (
						<span
							key={severity}
							className={`diagnostic-severity-chip ${getSeverityClass(severity)}`}
						>
							{severity}
							<strong>{dashboard.severityCounts[severity] ?? 0}</strong>
						</span>
					))}
				</div>
				<Metric
					label="Open work"
					value={`${decisions.undecidedFindings} undecided`}
				/>
			</DashboardGroup>

			<DashboardGroup
				title="Decisions"
				icon={<ClipboardCheck className="icon" />}
			>
				<div className="diagnostic-progress-line">
					<span
						style={{
							width: progressWidth(
								decisions.decidedFindings,
								decisions.totalFindings,
							),
						}}
					/>
				</div>
				<div className="diagnostic-metric-grid">
					<Metric
						label="Decided"
						value={`${decisions.decidedFindings}/${decisions.totalFindings}`}
					/>
					<Metric label="Needs fix" value={String(decisions.needsFix)} />
					<Metric
						label="False positive"
						value={String(decisions.falsePositive)}
					/>
					<Metric label="Deferred" value={String(decisions.deferred)} />
				</div>
			</DashboardGroup>

			<DashboardGroup title="Diagnostics" icon={<Radar className="icon" />}>
				<div className="diagnostic-metric-grid">
					<Metric
						label="Attack surface"
						value={String(diagnostics.attackSurfaceItems)}
					/>
					<Metric label="Checks" value={String(diagnostics.securityChecks)} />
					<Metric
						label="Coverage gaps"
						value={String(diagnostics.coverageGaps)}
					/>
					<Metric
						label="Scan reviews"
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
							<span key={blocker}>{blocker.replace(/_/g, " ")}</span>
						))}
					</div>
				) : null}
			</DashboardGroup>

			<DashboardGroup title="Next Actions" icon={<FileText className="icon" />}>
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
						<div className="diagnostic-empty-action">No immediate action</div>
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
	if (scanReports > 0) return ready ? "Report ready" : "Report present";
	return ready ? "Ready to generate" : "Report blocked";
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
