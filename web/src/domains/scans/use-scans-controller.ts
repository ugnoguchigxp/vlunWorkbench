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
	let workspaceScope: ReturnType<typeof buildScanWorkspaceActions> | null =
		null;
	let reportingScope: ReturnType<typeof buildScanReportingActions> | null =
		null;
	let handoffScope: ReturnType<typeof buildScanHandoffActions> | null = null;
	let findingScope: ReturnType<typeof useScansFindingActions> | null = null;
	const bridgeScope = {
		...baseScope,
		...effectsScope,
		...findingEffectsScope,
		reloadDiagnostics: (...args: [scanRunId?: string]) => {
			if (!handoffScope)
				throw new Error("Scan handoff actions are not initialized.");
			return handoffScope.reloadDiagnostics(...args);
		},
		getReportQualityPreview: () => {
			if (!findingScope)
				throw new Error("Scan finding actions are not initialized.");
			return findingScope.reportQualityPreview;
		},
	};
	findingScope = useScansFindingActions(bridgeScope);
	const actionScope = { ...bridgeScope, ...findingScope };
	workspaceScope = buildScanWorkspaceActions(actionScope);
	reportingScope = buildScanReportingActions(actionScope);
	handoffScope = buildScanHandoffActions(actionScope);
	return buildScansControllerViewModel({
		...bridgeScope,
		...findingScope,
		...workspaceScope,
		...reportingScope,
		...handoffScope,
	});
};

export type ScansController = ReturnType<typeof useScansController>;
