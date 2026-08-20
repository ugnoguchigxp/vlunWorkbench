import type { ScanRun } from "../../../api";

const statusLabels: Record<ScanRun["status"], string> = {
	queued: "待機中",
	running: "実行中",
	completed: "完了",
	failed: "失敗",
	cancelled: "取消済み",
};

export function ScanContextBar({ scan }: { scan: ScanRun | null }) {
	if (!scan) {
		return (
			<div className="workspace-scan-context empty">
				まだスキャン結果はありません。
			</div>
		);
	}
	return (
		<div className="workspace-scan-context">
			<div>
				<span>選択中のスキャン</span>
				<strong>{scan.profile}</strong>
			</div>
			<span className={`workspace-scan-status ${scan.status}`}>
				{statusLabels[scan.status]}
			</span>
			<time dateTime={scan.createdAt}>
				{new Intl.DateTimeFormat("ja-JP", {
					dateStyle: "medium",
					timeStyle: "short",
				}).format(new Date(scan.createdAt))}
			</time>
		</div>
	);
}
