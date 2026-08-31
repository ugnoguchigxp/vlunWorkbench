import type { useScansFindingActions } from "../findings/scans-finding-actions";
import type { ScansControllerBaseScope } from "../use-scans-base-controller";

export type ScansActionScope = ScansControllerBaseScope & {
	getReportQualityPreview: () => ReturnType<
		typeof useScansFindingActions
	>["reportQualityPreview"];
};
