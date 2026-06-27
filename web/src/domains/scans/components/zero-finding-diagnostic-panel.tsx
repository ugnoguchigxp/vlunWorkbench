import {
	AlertTriangle,
	FileText,
	ListChecks,
	Play,
	ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";

const ACTION_LABELS = {
	run_inventory: "診断インベントリを実行",
	run_security_checks: "セキュリティチェックを実行",
	generate_diagnostic_report: "診断レポートを生成",
} as const;

const CHECK_STATUS_LABELS: Record<string, string> = {
	pass: "確認済み",
	fail: "問題あり",
	warn: "注意",
	not_applicable: "対象外",
	manual_review: "追加確認",
	not_checked: "未確認",
};

const SCAN_STATUS_LABELS: Record<string, string> = {
	queued: "待機中",
	running: "実行中",
	completed: "完了",
	failed: "失敗",
	cancelled: "キャンセル",
};

export function ZeroFindingDiagnosticPanel() {
	const c = useScans();
	const summary = c.selectedCoverageSummary;
	const scanRun = c.selectedScanRun;
	const actionDisabled =
		!scanRun || scanRun.status !== "completed" || c.diagnosticLoading;
	const passCount = summary.checkStatusCounts.pass ?? 0;
	const reviewCount =
		(summary.checkStatusCounts.manual_review ?? 0) +
		(summary.checkStatusCounts.warn ?? 0);
	const notCheckedCount = summary.checkStatusCounts.not_checked ?? 0;
	const categories = categoryEntries(summary);

	return (
		<div className="zero-finding-panel">
			<div className="zero-finding-head">
				<div>
					<h3>検出 0 件の診断</h3>
					<p>
						finding 0 件は、設定されたスキャナーが正規化済み finding
						を出さなかったという意味です。安全であることの証明ではありません。
					</p>
				</div>
				<span className="zero-finding-badge">検出 0 件</span>
			</div>

			<div className="zero-finding-grid">
				<Section
					icon={<ShieldCheck className="icon" />}
					title="スキャン結果"
					description="この scan run の profile、tool、完了状態を確認します。"
				>
					<div className="zero-finding-facts">
						<Fact
							label="プロファイル"
							value={scanRun?.profile ?? "scan run 未選択"}
						/>
						<Fact
							label="状態"
							value={
								scanRun
									? (SCAN_STATUS_LABELS[scanRun.status] ?? scanRun.status)
									: "未選択"
							}
						/>
						<Fact
							label="完了日時"
							value={
								scanRun?.completedAt
									? formatDateTime(scanRun.completedAt)
									: "未完了"
							}
						/>
					</div>
					{summary.toolCoverage.length > 0 ? (
						<table className="coverage-mini-table">
							<thead>
								<tr>
									<th>ツール</th>
									<th>状態</th>
									<th>検出数</th>
								</tr>
							</thead>
							<tbody>
								{summary.toolCoverage.map((tool) => (
									<tr key={tool.toolName}>
										<td>{tool.toolName}</td>
										<td>{tool.status}</td>
										<td>{tool.findingCount}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<p className="zero-finding-empty">
							この scan の tool 別 summary はまだ利用できません。
						</p>
					)}
				</Section>

				<Section
					icon={<ListChecks className="icon" />}
					title="確認済みの範囲"
					description="観測済み attack surface と、完了した決定的チェックを表示します。"
				>
					<div className="zero-finding-metrics">
						<Metric label="確認済みチェック" value={passCount} />
						<Metric label="カテゴリ" value={categories.length} />
						<Metric label="追加確認・注意" value={reviewCount} />
					</div>
					{categories.length > 0 ? (
						<div className="coverage-chip-list">
							{categories.map(([category, count]) => (
								<span key={category}>
									{category} <strong>{count}</strong>
								</span>
							))}
						</div>
					) : (
						<p className="zero-finding-empty">
							この scan の診断インベントリはまだ生成されていません。
						</p>
					)}
				</Section>

				<Section
					icon={<AlertTriangle className="icon" />}
					title="確認が必要な課題"
					description="低リスクの根拠として扱う前に確認が必要なチェックです。"
				>
					{Object.keys(summary.checkStatusCounts).length > 0 ? (
						<table className="coverage-mini-table">
							<thead>
								<tr>
									<th>状態</th>
									<th>件数</th>
								</tr>
							</thead>
							<tbody>
								{Object.entries(summary.checkStatusCounts).map(
									([status, count]) => (
										<tr key={status}>
											<td>{CHECK_STATUS_LABELS[status] ?? status}</td>
											<td>{count}</td>
										</tr>
									),
								)}
							</tbody>
						</table>
					) : (
						<p className="zero-finding-empty">
							この scan のセキュリティチェックはまだ生成されていません。
						</p>
					)}
					{notCheckedCount > 0 ? (
						<p className="coverage-warning-copy">
							未確認のカテゴリまたは境界が {notCheckedCount} 件あります。
						</p>
					) : null}
				</Section>

				<Section
					icon={<AlertTriangle className="icon" />}
					title="カバレッジギャップ"
					description="保存済み診断だけでは未回答のまま残っている確認事項です。"
				>
					{summary.coverageGaps.length > 0 ? (
						<table className="coverage-gap-table">
							<thead>
								<tr>
									<th>状態</th>
									<th>課題</th>
									<th>カテゴリ</th>
								</tr>
							</thead>
							<tbody>
								{summary.coverageGaps.map((gap) => (
									<tr key={gap.id}>
										<td>
											<span className={`coverage-status status-${gap.status}`}>
												{CHECK_STATUS_LABELS[gap.status] ?? gap.status}
											</span>
										</td>
										<td>
											<strong>{gap.title}</strong>
											<small>{gap.summary}</small>
										</td>
										<td>{gap.category ?? "未分類"}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : (
						<p className="zero-finding-empty">
							この scan に記録済みのカバレッジギャップはありません。
						</p>
					)}
				</Section>

				<Section
					icon={<FileText className="icon" />}
					title="診断レポート"
					description="完了済みの最新 zero-finding 診断 summary です。"
				>
					{summary.latestDiagnosticReport ? (
						<div className="diagnostic-report-preview">
							<strong>
								{summary.latestDiagnosticReport.summary ??
									"完了済みの診断レポートがあります。"}
							</strong>
							<small>
								生成日時{" "}
								{formatDateTime(summary.latestDiagnosticReport.createdAt)}
							</small>
							{summary.latestDiagnosticReport.artifactId ? (
								<a
									href={`/api/diagnostic-reports/${summary.latestDiagnosticReport.id}/download`}
									target="_blank"
									rel="noreferrer"
								>
									Markdown レポートを開く
								</a>
							) : null}
							<JsonPreview
								label="推奨される次の確認"
								value={
									summary.latestDiagnosticReport.recommendedNextActionsJson
								}
							/>
						</div>
					) : (
						<p className="zero-finding-empty">
							この scan の診断レポートはまだ生成されていません。
						</p>
					)}
					<div className="zero-finding-actions">
						<ActionButton
							label={ACTION_LABELS.run_inventory}
							required={summary.missingActions.includes("run_inventory")}
							disabled={actionDisabled}
							onClick={c.handleRunAttackSurfaceInventory}
						/>
						<ActionButton
							label={ACTION_LABELS.run_security_checks}
							required={summary.missingActions.includes("run_security_checks")}
							disabled={actionDisabled}
							onClick={c.handleRunSecurityChecks}
						/>
						<ActionButton
							label={ACTION_LABELS.generate_diagnostic_report}
							required={summary.missingActions.includes(
								"generate_diagnostic_report",
							)}
							disabled={actionDisabled}
							onClick={c.handleGenerateDiagnosticReport}
						/>
					</div>
				</Section>
			</div>
		</div>
	);
}

function Section({
	icon,
	title,
	description,
	children,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="zero-finding-section">
			<div className="zero-finding-section-head">
				{icon}
				<div>
					<h4>{title}</h4>
					<p>{description}</p>
				</div>
			</div>
			{children}
		</section>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: number }) {
	return (
		<div>
			<strong>{value}</strong>
			<span>{label}</span>
		</div>
	);
}

function ActionButton({
	label,
	required,
	disabled,
	onClick,
}: {
	label: string;
	required: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className={required ? "coverage-action required" : "coverage-action"}
			disabled={disabled}
			onClick={onClick}
		>
			<Play className="icon" />
			<span>{label}</span>
			{required ? <strong>未実行</strong> : null}
		</button>
	);
}

function JsonPreview({
	label,
	value,
}: {
	label: string;
	value: Array<Record<string, unknown>>;
}) {
	if (value.length === 0) return null;
	return (
		<div className="diagnostic-report-json-preview">
			<span>{label}</span>
			<ul>
				{value.slice(0, 3).map((item) => {
					const text =
						typeof item.title === "string"
							? item.title
							: typeof item.summary === "string"
								? item.summary
								: JSON.stringify(item);
					const key =
						typeof item.id === "string" ? item.id : `${label}-${text}`;
					return <li key={key}>{text}</li>;
				})}
			</ul>
		</div>
	);
}

function categoryEntries(summary: {
	attackSurfaceCounts: Record<string, number>;
}) {
	return Object.entries(summary.attackSurfaceCounts).sort((a, b) =>
		a[0].localeCompare(b[0]),
	);
}
