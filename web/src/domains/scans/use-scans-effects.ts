import { useEffect } from "react";
import {
	fetchProjects,
	fetchScan,
	fetchScanEvents,
	fetchScanFindings,
	fetchScanReports,
	fetchScanReviews,
	fetchScanSummary,
	fetchScans,
	type ScanRun,
} from "../../api";
import { readRemediationMetadata } from "./remediation-plan";

export type ScansDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (text: string | null) => void;
};
export function useScansEffects(scope: Record<string, any>) {
	const {
		active,
		linkReviewDefaultFindingRef,
		requestedProjectId,
		requestedScanRunId,
		selectedDecisionWorkflow,
		selectedFindingDetails,
		selectedFindingId,
		selectedFindingIdRef,
		selectedPollingStatus,
		selectedProjectId,
		selectedScanRunId,
		setAllDecisions,
		setAllReviews,
		setCommentInput,
		setDecisionInput,
		setErrorText,
		setFindings,
		setFindingsLoading,
		setLinkReviewInput,
		setProjects,
		setReasonInput,
		setRemediationDueDateInput,
		setRemediationFixInput,
		setRemediationOwnerInput,
		setRemediationPriorityInput,
		setRemediationStatusInput,
		setReports,
		setReviewError,
		setScanDetailTab,
		setScanEvents,
		setScanReviews,
		setScanRuns,
		setScanSummary,
		setSelectedFindingDetails,
		setSelectedFindingId,
		setSelectedProjectId,
		setSelectedScanRunId,
	} = scope;
	useEffect(() => {
		selectedFindingIdRef.current = selectedFindingId;
	}, [selectedFindingId, selectedFindingIdRef]);

	useEffect(() => {
		if (!selectedFindingId) {
			linkReviewDefaultFindingRef.current = null;
			setLinkReviewInput(false);
			setRemediationStatusInput("not_started");
			setRemediationOwnerInput("");
			setRemediationPriorityInput("p2");
			setRemediationDueDateInput("");
			setRemediationFixInput("");
			return;
		}
		if (
			!selectedFindingDetails ||
			selectedFindingDetails.finding.id !== selectedFindingId ||
			linkReviewDefaultFindingRef.current === selectedFindingId
		) {
			return;
		}
		linkReviewDefaultFindingRef.current = selectedFindingId;
		setDecisionInput("needs_fix");
		setReasonInput(
			selectedDecisionWorkflow?.recommendedReason ?? "confirmed_by_evidence",
		);
		setCommentInput("");
		setLinkReviewInput(Boolean(selectedFindingDetails.latestReview));
	}, [
		selectedFindingId,
		selectedFindingDetails,
		selectedDecisionWorkflow,
		setRemediationDueDateInput,
		setRemediationStatusInput,
		setReasonInput,
		setDecisionInput,
		setCommentInput,
		setLinkReviewInput,
		linkReviewDefaultFindingRef.current,
		setRemediationFixInput,
		setRemediationPriorityInput,
		setRemediationOwnerInput,
		linkReviewDefaultFindingRef,
	]);

	useEffect(() => {
		const decision = selectedFindingDetails?.latestDecision;
		const metadata = readRemediationMetadata(decision);
		const fallbackStatus =
			decision?.decision === "accepted"
				? "accepted"
				: decision?.decision === "false_positive"
					? "false_positive"
					: decision?.decision === "deferred"
						? "deferred"
						: "not_started";
		setRemediationStatusInput(metadata.status ?? fallbackStatus);
		setRemediationOwnerInput(metadata.owner ?? "");
		setRemediationPriorityInput(metadata.priority ?? "p2");
		setRemediationDueDateInput(metadata.dueDate ?? "");
		setRemediationFixInput(
			metadata.recommendedFix ??
				selectedFindingDetails?.latestReview?.remediationDirection ??
				"",
		);
	}, [
		selectedFindingDetails,
		setRemediationFixInput,
		setRemediationPriorityInput,
		setRemediationOwnerInput,
		setRemediationDueDateInput,
		setRemediationStatusInput,
	]);

	useEffect(() => {
		if (!active) return;
		void fetchProjects()
			.then((items) => {
				setProjects(items);
				setSelectedProjectId((current: string) => {
					const preferred = requestedProjectId || current;
					return items.some((item) => item.id === preferred)
						? preferred
						: (items[0]?.id ?? "");
				});
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error
						? err.message
						: "プロジェクトの読み込みに失敗しました。",
				),
			);
	}, [
		active,
		requestedProjectId,
		setErrorText,
		setSelectedProjectId,
		setProjects,
	]);

	useEffect(() => {
		if (!active || !selectedProjectId) return;
		setSelectedFindingId("");
		setSelectedFindingDetails(null);
		setScanDetailTab("review");
		void fetchScans(selectedProjectId)
			.then((runs) => {
				setScanRuns(runs);
				setSelectedScanRunId(
					runs.some((run) => run.id === requestedScanRunId)
						? requestedScanRunId
						: (runs[0]?.id ?? ""),
				);
				if (!runs[0]) {
					setFindings([]);
					setSelectedFindingId("");
					setSelectedFindingDetails(null);
				}
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error
						? err.message
						: "scan の読み込みに失敗しました。",
				),
			);
	}, [
		active,
		requestedScanRunId,
		selectedProjectId,
		setErrorText,
		setSelectedScanRunId,
		setSelectedFindingId,
		setFindings,
		setSelectedFindingDetails,
		setScanDetailTab,
		setScanRuns,
	]);

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setScanEvents([]);
			return;
		}
		if (
			selectedPollingStatus !== "queued" &&
			selectedPollingStatus !== "running"
		) {
			void fetchScanEvents(selectedScanRunId)
				.then(setScanEvents)
				.catch(() => {});
			return;
		}
		let mounted = true;
		let polling = false;
		const poll = async () => {
			if (polling) return;
			polling = true;
			try {
				const [scan, events] = await Promise.all([
					fetchScan(selectedScanRunId),
					fetchScanEvents(selectedScanRunId),
				]);
				if (!mounted) return;
				setScanEvents(events);
				setScanRuns((runs: ScanRun[]) =>
					runs.map((item: ScanRun) => (item.id === scan.id ? scan : item)),
				);
				if (scan.status !== "queued" && scan.status !== "running") {
					const [runs, nextFindings, nextSummary, nextReviews, nextReports] =
						await Promise.all([
							fetchScans(scan.projectId),
							fetchScanFindings(scan.id),
							fetchScanSummary(scan.id).catch(() => null),
							fetchScanReviews(scan.id),
							fetchScanReports(scan.id),
						]);
					if (!mounted) return;
					setScanRuns(runs);
					setFindings(nextFindings);
					setScanSummary(nextSummary);
					setScanReviews(nextReviews);
					setReports(nextReports);
				}
			} catch (error) {
				if (mounted)
					setErrorText(error instanceof Error ? error.message : String(error));
			} finally {
				polling = false;
			}
		};
		void poll();
		const timer = setInterval(() => void poll(), 1_500);
		return () => {
			mounted = false;
			clearInterval(timer);
		};
	}, [
		active,
		selectedPollingStatus,
		selectedScanRunId,
		setErrorText,
		setFindings,
		setScanReviews,
		setScanEvents,
		setScanSummary,
		setReports,
		setScanRuns,
	]);

	useEffect(() => {
		setSelectedFindingId("");
		setSelectedFindingDetails(null);
		setAllReviews([]);
		setReviewError(null);
		setAllDecisions([]);
		setScanDetailTab("review");
		if (!active || !selectedScanRunId) {
			setFindingsLoading(false);
			return;
		}
		setFindingsLoading(true);
		void fetchScanFindings(selectedScanRunId)
			.then((items) => {
				setFindings(items);
				setSelectedFindingId((current: string) =>
					current && items.some((item) => item.id === current) ? current : "",
				);
				if (!items.some((item) => item.id === selectedFindingIdRef.current)) {
					setSelectedFindingDetails(null);
				}
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error
						? err.message
						: "finding の読み込みに失敗しました。",
				),
			)
			.finally(() => setFindingsLoading(false));
	}, [
		active,
		selectedScanRunId,
		setErrorText,
		setSelectedFindingId,
		setAllReviews,
		setScanDetailTab,
		setReviewError,
		setFindings,
		setSelectedFindingDetails,
		selectedFindingIdRef.current,
		setFindingsLoading,
		setAllDecisions,
	]);

	return {};
}
