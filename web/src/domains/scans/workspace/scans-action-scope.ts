import type { useScansFindingActions } from "../findings/scans-finding-actions";
import type { useFindingLoadEffects } from "../use-finding-load-effects";
import type { useScanTargetEffects } from "../use-scan-target-effects";
import type { ScansControllerBaseScope } from "../use-scans-base-controller";

export type ScansActionScope = ScansControllerBaseScope &
	ReturnType<typeof useFindingLoadEffects> &
	ReturnType<typeof useScanTargetEffects> & {
		getReportQualityPreview: () => ReturnType<
			typeof useScansFindingActions
		>["reportQualityPreview"];
	};
