import { useCallback, useEffect, useState } from "react";
import { deleteScan, isApiRequestError, type ScanRun } from "../../api";

export function useScanDeleteController(params: {
	onDeleted: (scanRunId: string) => void;
}) {
	const [scan, setScan] = useState<ScanRun | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [toast, setToast] = useState<string | null>(null);

	useEffect(() => {
		if (!toast) return;
		const timeout = window.setTimeout(() => setToast(null), 5_000);
		return () => window.clearTimeout(timeout);
	}, [toast]);

	const open = useCallback((nextScan: ScanRun) => {
		if (nextScan.status === "queued" || nextScan.status === "running") return;
		setScan(nextScan);
		setError(null);
	}, []);
	const close = useCallback(() => {
		if (submitting) return;
		setScan(null);
		setError(null);
	}, [submitting]);
	const submit = useCallback(async () => {
		if (!scan || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			await deleteScan(scan.id);
			params.onDeleted(scan.id);
			setToast(`「${scan.profile}」のスキャン履歴を削除しました`);
			setScan(null);
		} catch (caught) {
			if (isApiRequestError(caught) && caught.code === "SCAN_HAS_ACTIVE_WORK") {
				setError("実行中の処理を停止してから削除してください。");
			} else if (isApiRequestError(caught) && caught.status === 404) {
				params.onDeleted(scan.id);
				setScan(null);
				setError(null);
			} else {
				setError(
					caught instanceof Error
						? caught.message
						: "スキャン履歴の削除に失敗しました。",
				);
			}
		} finally {
			setSubmitting(false);
		}
	}, [params, scan, submitting]);

	return { scan, error, submitting, toast, open, close, submit };
}
