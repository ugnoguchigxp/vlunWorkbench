import { useScansFindingActions } from "./findings/scans-finding-actions";
import { buildScanHandoffActions } from "./handoff/scans-handoff-actions";
import { buildScanReportingActions } from "./reporting/scans-reporting-actions";
import { buildScansControllerViewModel } from "./scans-controller-view-model";
import {
	type ScansControllerBaseProps,
	useScansControllerBase,
} from "./use-scans-base-controller";
import { buildScanWorkspaceActions } from "./workspace/scans-workspace-actions";

export type ScansDomainSectionProps = ScansControllerBaseProps;

export const useScansController = (props: ScansDomainSectionProps) => {
	const baseScope = useScansControllerBase(props);
	const findingScope = useScansFindingActions(baseScope);
	const actionScope = {
		...baseScope,
		...findingScope,
		getReportQualityPreview: () => findingScope.reportQualityPreview,
	};
	const workspaceScope = buildScanWorkspaceActions(actionScope);
	const reportingScope = buildScanReportingActions(actionScope);
	const handoffScope = buildScanHandoffActions(actionScope);
	return buildScansControllerViewModel({
		...actionScope,
		...workspaceScope,
		...reportingScope,
		...handoffScope,
	});
};

export type ScansController = ReturnType<typeof useScansController>;
