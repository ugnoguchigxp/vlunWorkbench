import { buildScanHandoffActions } from "./handoff/scans-handoff-actions";
import { buildScanReportingActions } from "./reporting/scans-reporting-actions";
import type { ScansActionScope } from "./workspace/scans-action-scope";
import { buildScanWorkspaceActions } from "./workspace/scans-workspace-actions";

export function buildScanLaunchActions(scope: ScansActionScope) {
	return {
		...buildScanWorkspaceActions(scope),
		...buildScanReportingActions(scope),
		...buildScanHandoffActions(scope),
	};
}
