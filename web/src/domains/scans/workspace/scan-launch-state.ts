import type { ScanRun } from "../../../api";

type ScanStatus = Pick<ScanRun, "status">;

export function isScanLaunchInProgress(
	requestPending: boolean,
	scanRuns: readonly ScanStatus[],
): boolean {
	return (
		requestPending ||
		scanRuns.some(
			(scan) => scan.status === "queued" || scan.status === "running",
		)
	);
}
