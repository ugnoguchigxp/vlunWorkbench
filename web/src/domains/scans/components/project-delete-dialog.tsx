import type { Project } from "../../../api";
import { Dialog } from "../../../components/dialog";
import { Button, TextInput } from "../../../ui";

export function ProjectDeleteDialog({
	project,
	confirmation,
	error,
	submitting,
	canSubmit,
	onConfirmationChange,
	onClose,
	onConfirm,
}: {
	project: Project | null;
	confirmation: string;
	error: string | null;
	submitting: boolean;
	canSubmit: boolean;
	onConfirmationChange: (value: string) => void;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const title = project
		? `プロジェクト「${project.name}」を削除しますか？`
		: "プロジェクトを削除";
	return (
		<Dialog open={Boolean(project)} title={title} onClose={onClose}>
			{project ? (
				<div className="workspace-delete-dialog-body">
					<p>
						この操作は取り消せません。スキャン履歴、検出結果、注釈、レポートを削除します。ローカルのリポジトリファイルは削除されません。
					</p>
					<dl className="workspace-delete-project-meta">
						<div><dt>ブランチ</dt><dd>{project.defaultBranch}</dd></div>
						<div><dt>リポジトリ</dt><dd>{project.repoPath}</dd></div>
					</dl>
					<label htmlFor="project-delete-confirmation">
						確認のため {project.name} と入力してください
						<TextInput
							id="project-delete-confirmation"
							value={confirmation}
							onChange={(event) => onConfirmationChange(event.target.value)}
							disabled={submitting}
						/>
					</label>
					{error ? <p className="workspace-dialog-error" role="alert">{error}</p> : null}
					<div className="workspace-dialog-actions">
						<Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>キャンセル</Button>
						<Button type="button" variant="destructive" onClick={onConfirm} disabled={!canSubmit}>
							{submitting ? "削除中..." : "プロジェクトを削除"}
						</Button>
					</div>
				</div>
			) : null}
		</Dialog>
	);
}
