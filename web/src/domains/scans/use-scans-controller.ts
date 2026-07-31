import { buildScansControllerViewModel } from "./scans-controller-view-model";
import { useScansFindingActions } from "./scans-finding-actions";
import { buildScanLaunchActions } from "./scans-launch-actions";
import {
	type ScansControllerBaseProps,
	useScansControllerBase,
} from "./use-scans-base-controller";
import { useFindingLoadEffects } from "./use-finding-load-effects";
import { useScanTargetEffects } from "./use-scan-target-effects";
import { useScansEffects } from "./use-scans-effects";

export type ScansDomainSectionProps = ScansControllerBaseProps;

export const useScansController = (props: ScansDomainSectionProps) => {
	const baseScope = useScansControllerBase(props);
	const effectsScope = {
		...useScansEffects(baseScope),
		...useScanTargetEffects(baseScope),
	};
	const findingEffectsScope = useFindingLoadEffects(baseScope);
	let launchScope: ReturnType<typeof buildScanLaunchActions> | null = null;
	let findingScope: ReturnType<typeof useScansFindingActions> | null = null;
	const bridgeScope = {
		...baseScope,
		...effectsScope,
		...findingEffectsScope,
		reloadDiagnostics: (...args: [scanRunId?: string]) => {
			if (!launchScope)
				throw new Error("Scan launch actions are not initialized.");
			return launchScope.reloadDiagnostics(...args);
		},
		getReportQualityPreview: () => {
			if (!findingScope)
				throw new Error("Scan finding actions are not initialized.");
			return findingScope.reportQualityPreview;
		},
	};
	findingScope = useScansFindingActions(bridgeScope);
	launchScope = buildScanLaunchActions({ ...bridgeScope, ...findingScope });
	return buildScansControllerViewModel({
		...bridgeScope,
		...findingScope,
		...launchScope,
	});
};

export type ScansController = ReturnType<typeof useScansController>;
