import type { ScanRun } from "../../../api";
import { Dialog } from "../../../components/dialog";
import { Button } from "../../../ui";

const statusLabels: Record<ScanRun["status"], string> = {
	queued: "待機中",
	running: "実行中",
	completed: "完了",
	failed: "失敗",
	cancelled: "取消済み",
};

export function ScanDeleteDialog({
	scan,
	error,
	submitting,
	onClose,
	onConfirm,
}: {
	scan: ScanRun | null;
	error: string | null;
	submitting: boolean;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const title = scan
		? `「${scan.profile}」のスキャン履歴を削除しますか？`
		: "スキャン履歴を削除";
	return (
		<Dialog open={Boolean(scan)} title={title} onClose={onClose}>
			{scan ? (
				<div className="workspace-delete-dialog-body">
					<p>
						この操作は取り消せません。このスキャンの検出結果、レビュー、レポート、保存済み成果物も削除します。
					</p>
					<dl className="workspace-delete-project-meta">
						<div>
							<dt>状態</dt>
							<dd>{statusLabels[scan.status]}</dd>
						</div>
						<div>
							<dt>実行日時</dt>
							<dd>{new Date(scan.createdAt).toLocaleString("ja-JP")}</dd>
						</div>
					</dl>
					{error ? (
						<p className="workspace-dialog-error" role="alert">
							{error}
						</p>
					) : null}
					<div className="workspace-dialog-actions">
						<Button
							type="button"
							variant="secondary"
							onClick={onClose}
							disabled={submitting}
						>
							キャンセル
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={onConfirm}
							disabled={submitting}
						>
							{submitting ? "削除中..." : "履歴を削除"}
						</Button>
					</div>
				</div>
			) : null}
		</Dialog>
	);
}
