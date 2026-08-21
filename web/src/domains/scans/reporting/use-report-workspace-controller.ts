import { useEffect, useMemo, useRef, useState } from "react";
import {
	downloadScanReportMarkdown,
	fetchScanReport,
	fetchScanReportViewerState,
	markScanReportLlmCommentSeen,
	type ScanReport,
	type ScanReportViewerState,
	type ScanReview,
} from "../../../api";
import {
	hasLlmComment,
	selectWorkspaceReportId,
} from "./report-workspace-view-model";

type ReportWorkspaceStatus = "empty" | "loading" | "ready" | "failed";

export function useReportWorkspaceController({
	reports,
	scanReviews,
	requestedReportId,
}: {
	reports: ScanReport[];
	scanReviews: ScanReview[];
	requestedReportId?: string;
}) {
	const reportId = useMemo(
		() => selectWorkspaceReportId(reports, requestedReportId),
		[reports, requestedReportId],
	);
	const [report, setReport] = useState<ScanReport | null>(null);
	const [markdown, setMarkdown] = useState("");
	const [viewerState, setViewerState] = useState<ScanReportViewerState | null>(
		null,
	);
	const [status, setStatus] = useState<ReportWorkspaceStatus>("empty");
	const [error, setError] = useState<string | null>(null);
	const [acknowledging, setAcknowledging] = useState(false);
	const [acknowledgementError, setAcknowledgementError] = useState<
		string | null
	>(null);
	const requestId = useRef(0);
	const reportIdRef = useRef<string | null>(reportId);

	useEffect(() => {
		reportIdRef.current = reportId;
		setAcknowledging(false);
		setAcknowledgementError(null);
	}, [reportId]);

	useEffect(() => {
		const currentRequestId = ++requestId.current;
		if (!reportId) {
			setReport(null);
			setMarkdown("");
			setViewerState(null);
			setError(null);
			setStatus("empty");
			return;
		}
		setStatus("loading");
		setError(null);
		void Promise.all([
			fetchScanReport(reportId),
			fetchScanReportViewerState(reportId),
		])
			.then(async ([reportResponse, nextViewerState]) => {
				const nextMarkdown =
					reportResponse.report.status === "completed"
						? await downloadScanReportMarkdown(reportId)
						: "";
				if (requestId.current !== currentRequestId) return;
				setReport(reportResponse.report);
				setViewerState(nextViewerState);
				setMarkdown(nextMarkdown);
				setStatus("ready");
			})
			.catch((cause: unknown) => {
				if (requestId.current !== currentRequestId) return;
				setReport(null);
				setViewerState(null);
				setMarkdown("");
				setStatus("failed");
				setError(
					cause instanceof Error
						? cause.message
						: "レポートを読み込めませんでした。",
				);
			});
	}, [reportId]);

	const review = useMemo(
		() => scanReviews.find((item) => item.status === "completed") ?? null,
		[scanReviews],
	);
	const llmCommentAvailable = hasLlmComment(review);
	const llmCommentForcedOpen =
		llmCommentAvailable && viewerState?.llmCommentSeenAt == null;
	const acknowledgeLlmComment = async (): Promise<void> => {
		if (!reportId || !llmCommentForcedOpen || acknowledging) return;
		setAcknowledging(true);
		setAcknowledgementError(null);
		try {
			const nextViewerState = await markScanReportLlmCommentSeen(reportId);
			if (reportIdRef.current === reportId) setViewerState(nextViewerState);
		} catch (cause) {
			if (reportIdRef.current === reportId) {
				setAcknowledgementError(
					cause instanceof Error
						? cause.message
						: "LLMコメントの確認状態を保存できませんでした。",
				);
			}
		} finally {
			if (reportIdRef.current === reportId) setAcknowledging(false);
		}
	};

	return {
		reportId,
		report,
		markdown,
		viewerState,
		status,
		error,
		review,
		llmCommentAvailable,
		llmCommentForcedOpen,
		acknowledging,
		acknowledgementError,
		acknowledgeLlmComment,
	};
}
