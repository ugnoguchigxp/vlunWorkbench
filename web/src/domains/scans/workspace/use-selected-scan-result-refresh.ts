import { type Dispatch, type SetStateAction, useEffect } from "react";
import {
	type Finding,
	fetchScan,
	fetchScanEvents,
	fetchScanFindings,
	fetchScanReports,
	fetchScanReviews,
	fetchScanSummary,
	fetchScans,
	type ScanEvent,
	type ScanReport,
	type ScanReview,
	type ScanRun,
	type ScanRunSummary,
} from "../../../api";

const SCAN_POLL_INTERVAL_MS = 1_500;
export const TERMINAL_RESULT_RETRY_DELAY_MS = 10_000;

const FINDING_RESULT_EVENT_TYPES = new Set([
	"finding.created",
	"scan.step.finished",
]);
const SUMMARY_RESULT_EVENT_TYPES = new Set(["scan.step.finished"]);

function latestMatchingEventSeq(
	events: readonly Pick<ScanEvent, "eventType" | "seq">[],
	eventTypes: ReadonlySet<string>,
): number {
	return events.reduce(
		(latest, event) =>
			eventTypes.has(event.eventType) ? Math.max(latest, event.seq) : latest,
		0,
	);
}

export function latestFindingResultEventSeq(
	events: readonly Pick<ScanEvent, "eventType" | "seq">[],
): number {
	return latestMatchingEventSeq(events, FINDING_RESULT_EVENT_TYPES);
}

export function latestSummaryResultEventSeq(
	events: readonly Pick<ScanEvent, "eventType" | "seq">[],
): number {
	return latestMatchingEventSeq(events, SUMMARY_RESULT_EVENT_TYPES);
}

type SelectedScanResultRefreshScope = {
	active: boolean;
	selectedPollingStatus: string | undefined;
	selectedProjectId: string;
	selectedScanRunId: string;
	setErrorText: (text: string | null) => void;
	setFindings: Dispatch<SetStateAction<Finding[]>>;
	setReports: Dispatch<SetStateAction<ScanReport[]>>;
	setScanEvents: Dispatch<SetStateAction<ScanEvent[]>>;
	setScanReviews: Dispatch<SetStateAction<ScanReview[]>>;
	setScanRuns: Dispatch<SetStateAction<ScanRun[]>>;
	setScanSummary: Dispatch<SetStateAction<ScanRunSummary | null>>;
};

export function useSelectedScanResultRefresh(
	scope: SelectedScanResultRefreshScope,
) {
	const {
		active,
		selectedPollingStatus,
		selectedProjectId,
		selectedScanRunId,
		setErrorText,
		setFindings,
		setReports,
		setScanEvents,
		setScanReviews,
		setScanRuns,
		setScanSummary,
	} = scope;
	const selectedScanActive =
		selectedPollingStatus === "queued" || selectedPollingStatus === "running";
	const selectedScanTerminal =
		selectedPollingStatus === "completed" ||
		selectedPollingStatus === "failed" ||
		selectedPollingStatus === "cancelled";

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setScanEvents([]);
			return;
		}
		if (!selectedScanActive) return;
		let mounted = true;
		let polling = false;
		let latestFindingsEventSeq = 0;
		let latestSummaryEventSeq = 0;
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
				setScanRuns((runs) =>
					runs.map((item) => (item.id === scan.id ? scan : item)),
				);

				const scanStillActive =
					scan.status === "queued" || scan.status === "running";
				if (!scanStillActive) return;
				const latestFindingsSeq = latestFindingResultEventSeq(events);
				const latestSummarySeq = latestSummaryResultEventSeq(events);
				const refreshFindings = latestFindingsSeq > latestFindingsEventSeq;
				const refreshSummary = latestSummarySeq > latestSummaryEventSeq;
				if (!refreshFindings && !refreshSummary) return;
				const [nextFindings, nextSummary] = await Promise.all([
					refreshFindings
						? fetchScanFindings(selectedScanRunId).catch(() => null)
						: Promise.resolve(null),
					refreshSummary
						? fetchScanSummary(selectedScanRunId).catch(() => null)
						: Promise.resolve(null),
				]);
				if (!mounted) return;
				if (nextFindings !== null) {
					setFindings(nextFindings);
					latestFindingsEventSeq = latestFindingsSeq;
				}
				if (nextSummary !== null) {
					setScanSummary(nextSummary);
					latestSummaryEventSeq = latestSummarySeq;
				}
			} catch (error) {
				if (mounted) {
					setErrorText(error instanceof Error ? error.message : String(error));
				}
			} finally {
				polling = false;
			}
		};
		void poll();
		const timer = setInterval(() => void poll(), SCAN_POLL_INTERVAL_MS);
		return () => {
			mounted = false;
			clearInterval(timer);
		};
	}, [
		active,
		selectedScanActive,
		selectedScanRunId,
		setErrorText,
		setFindings,
		setScanEvents,
		setScanSummary,
		setScanRuns,
	]);

	useEffect(() => {
		if (!active || !selectedScanRunId || !selectedScanTerminal) return;
		let mounted = true;
		let nextRequestId = 0;
		const latestAppliedRequestIds = {
			events: 0,
			findings: 0,
			summary: 0,
			reviews: 0,
			reports: 0,
			runs: 0,
		};
		const shouldApply = <T>(
			resource: keyof typeof latestAppliedRequestIds,
			requestId: number,
			value: T | null,
		): value is T => {
			if (value === null || requestId <= latestAppliedRequestIds[resource]) {
				return false;
			}
			latestAppliedRequestIds[resource] = requestId;
			return true;
		};
		const refreshTerminalResults = async () => {
			const requestId = ++nextRequestId;
			const [events, findings, summary, reviews, reports, runs] =
				await Promise.all([
					fetchScanEvents(selectedScanRunId).catch(() => null),
					fetchScanFindings(selectedScanRunId).catch(() => null),
					fetchScanSummary(selectedScanRunId).catch(() => null),
					fetchScanReviews(selectedScanRunId).catch(() => null),
					fetchScanReports(selectedScanRunId).catch(() => null),
					selectedProjectId
						? fetchScans(selectedProjectId).catch(() => null)
						: Promise.resolve(null),
				]);
			if (!mounted) return;
			if (shouldApply("events", requestId, events)) setScanEvents(events);
			if (shouldApply("findings", requestId, findings)) setFindings(findings);
			if (shouldApply("summary", requestId, summary)) setScanSummary(summary);
			if (shouldApply("reviews", requestId, reviews)) setScanReviews(reviews);
			if (shouldApply("reports", requestId, reports)) setReports(reports);
			if (shouldApply("runs", requestId, runs)) setScanRuns(runs);
		};
		void refreshTerminalResults();
		const retryTimer = setTimeout(
			() => void refreshTerminalResults(),
			TERMINAL_RESULT_RETRY_DELAY_MS,
		);
		return () => {
			mounted = false;
			clearTimeout(retryTimer);
		};
	}, [
		active,
		selectedProjectId,
		selectedScanRunId,
		selectedScanTerminal,
		setFindings,
		setReports,
		setScanEvents,
		setScanReviews,
		setScanRuns,
		setScanSummary,
	]);
}
