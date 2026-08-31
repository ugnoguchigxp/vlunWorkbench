import { type Dispatch, type SetStateAction, useEffect, useMemo } from "react";
import {
	fetchScanFindings,
	fetchScanGroups,
	fetchScanSummary,
	type ScanRun,
} from "../../../api";
import type { DecisionWorkflowView } from "../decision-workflow";
import { readRemediationMetadata } from "../remediation-plan";
import type { ScanDetailTab } from "../workspace/use-scan-launch-state";
import { selectBaselineScanRun } from "./finding-derived";
import type { ScanFindingsState } from "./use-scan-findings-state";

type ScanFindingsEffectsScope = ScanFindingsState & {
	active: boolean;
	scanRuns: ScanRun[];
	selectedDecisionWorkflow: DecisionWorkflowView | null;
	selectedProjectId: string;
	selectedScanRunId: string;
	setErrorText: (text: string | null) => void;
	setScanDetailTab: Dispatch<SetStateAction<ScanDetailTab>>;
};

export function useScanFindingsEffects(scope: ScanFindingsEffectsScope) {
	const {
		active,
		linkReviewDefaultFindingRef,
		scanRuns,
		selectedDecisionWorkflow,
		selectedFindingDetails,
		selectedFindingId,
		selectedFindingIdRef,
		selectedProjectId,
		selectedScanRunId,
		setAllDecisions,
		setAllReviews,
		setBaselineFindings,
		setBaselineScanRunId,
		setCommentInput,
		setDecisionInput,
		setErrorText,
		setFindings,
		setFindingsLoading,
		setLinkReviewInput,
		setReasonInput,
		setRemediationDueDateInput,
		setRemediationFixInput,
		setRemediationOwnerInput,
		setRemediationPriorityInput,
		setRemediationStatusInput,
		setReviewError,
		setScanDetailTab,
		setScanGroups,
		setScanSummary,
		setSelectedFindingDetails,
		setSelectedFindingId,
		setSelectedGroupId,
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
		setSelectedFindingId("");
		setSelectedFindingDetails(null);
		if (!selectedProjectId) {
			setFindings([]);
			setFindingsLoading(false);
		}
	}, [
		selectedProjectId,
		setFindings,
		setFindingsLoading,
		setSelectedFindingDetails,
		setSelectedFindingId,
	]);

	useEffect(() => {
		setSelectedFindingId("");
		setSelectedFindingDetails(null);
		setAllReviews([]);
		setReviewError(null);
		setAllDecisions([]);
		setScanDetailTab("review");
		if (!active || !selectedScanRunId) {
			setFindings([]);
			setFindingsLoading(false);
			return;
		}
		let mounted = true;
		setFindingsLoading(true);
		void fetchScanFindings(selectedScanRunId)
			.then((items) => {
				if (!mounted) return;
				setFindings(items);
				setSelectedFindingId((current: string) =>
					current && items.some((item) => item.id === current) ? current : "",
				);
				if (!items.some((item) => item.id === selectedFindingIdRef.current)) {
					setSelectedFindingDetails(null);
				}
			})
			.catch((err) => {
				if (!mounted) return;
				setErrorText(
					err instanceof Error
						? err.message
						: "finding の読み込みに失敗しました。",
				);
			})
			.finally(() => {
				if (mounted) setFindingsLoading(false);
			});
		return () => {
			mounted = false;
		};
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

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setScanSummary(null);
			setScanGroups([]);
			setSelectedGroupId("");
			return;
		}
		let mounted = true;
		void fetchScanSummary(selectedScanRunId)
			.then((summary) => {
				if (mounted) setScanSummary(summary);
			})
			.catch(() => {
				if (mounted) setScanSummary(null);
			});
		void fetchScanGroups(selectedScanRunId)
			.then(({ groups }) => {
				if (mounted) setScanGroups(groups);
			})
			.catch(() => {
				if (mounted) setScanGroups([]);
			});
		return () => {
			mounted = false;
		};
	}, [
		active,
		selectedScanRunId,
		setSelectedGroupId,
		setScanSummary,
		setScanGroups,
	]);

	const selectedScanRun =
		scanRuns.find((run) => run.id === selectedScanRunId) ?? null;
	const baselineScanRun = useMemo(
		() => selectBaselineScanRun(scanRuns, selectedScanRun),
		[scanRuns, selectedScanRun],
	);
	useEffect(() => {
		let cancelled = false;
		setBaselineFindings(null);
		setBaselineScanRunId(baselineScanRun?.id ?? null);
		if (!baselineScanRun) return;
		void fetchScanFindings(baselineScanRun.id)
			.then((items) => {
				if (!cancelled) setBaselineFindings(items);
			})
			.catch(() => {
				if (!cancelled) setBaselineFindings(null);
			});
		return () => {
			cancelled = true;
		};
	}, [baselineScanRun, setBaselineFindings, setBaselineScanRunId]);
}
