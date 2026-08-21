import { useScansFindingActions } from "./findings/scans-finding-actions";
import { buildScanHandoffActions } from "./handoff/scans-handoff-actions";
import { buildScanReportingActions } from "./reporting/scans-reporting-actions";
import { buildScansControllerViewModel } from "./scans-controller-view-model";
import { useFindingLoadEffects } from "./use-finding-load-effects";
import { useScanTargetEffects } from "./use-scan-target-effects";
import {
	type ScansControllerBaseProps,
	useScansControllerBase,
} from "./use-scans-base-controller";
import { useScansEffects } from "./use-scans-effects";
import { buildScanWorkspaceActions } from "./workspace/scans-workspace-actions";

export type ScansDomainSectionProps = ScansControllerBaseProps;

export const useScansController = (props: ScansDomainSectionProps) => {
	const baseScope = useScansControllerBase(props);
	const effectsScope = {
		...useScansEffects(baseScope),
		...useScanTargetEffects(baseScope),
	};
	const findingEffectsScope = useFindingLoadEffects(baseScope);
	const findingScope = useScansFindingActions({
		...baseScope,
		...effectsScope,
		...findingEffectsScope,
	});
	const actionScope = {
		...baseScope,
		...effectsScope,
		...findingEffectsScope,
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
