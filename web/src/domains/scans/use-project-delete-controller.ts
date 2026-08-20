import { useCallback, useEffect, useState } from "react";
import { deleteProject, isApiRequestError, type Project } from "../../api";

export function useProjectDeleteController(params: {
	onDeleted: (projectId: string) => void;
}) {
	const [project, setProject] = useState<Project | null>(null);
	const [confirmation, setConfirmation] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	useEffect(() => {
		if (!toast) return;
		const timeout = window.setTimeout(() => setToast(null), 5_000);
		return () => window.clearTimeout(timeout);
	}, [toast]);

	const open = useCallback((nextProject: Project) => {
		setProject(nextProject);
		setConfirmation("");
		setError(null);
	}, []);
	const close = useCallback(() => {
		if (submitting) return;
		setProject(null);
		setConfirmation("");
		setError(null);
	}, [submitting]);
	const submit = useCallback(async () => {
		if (!project || confirmation !== project.name || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			await deleteProject(project.id, { confirmation });
			params.onDeleted(project.id);
			setToast(`プロジェクト「${project.name}」を削除しました`);
			setProject(null);
			setConfirmation("");
		} catch (caught) {
			if (
				isApiRequestError(caught) &&
				caught.code === "PROJECT_CONFIRMATION_MISMATCH"
			) {
				setError("プロジェクト名が一致しません。");
			} else if (
				isApiRequestError(caught) &&
				caught.code === "PROJECT_HAS_ACTIVE_WORK"
			) {
				setError("実行中の処理を停止してから削除してください。");
			} else if (isApiRequestError(caught) && caught.status === 404) {
				params.onDeleted(project.id);
				setProject(null);
				setError(null);
			} else {
				setError(
					caught instanceof Error
						? caught.message
						: "プロジェクトを削除できませんでした。",
				);
			}
		} finally {
			setSubmitting(false);
		}
	}, [confirmation, params, project, submitting]);

	return {
		project,
		confirmation,
		submitting,
		error,
		toast,
		canSubmit: Boolean(project && confirmation === project.name && !submitting),
		open,
		close,
		setConfirmation,
		submit,
		clearToast: () => setToast(null),
	};
}
