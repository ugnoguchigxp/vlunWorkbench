import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { Finding, FindingDecision } from "../../api";
import type { GuidedDecision } from "./project-intelligence-workspace-model";
import type { FindingDetail } from "./use-intelligence-workspace-data";

type ResourceStatus = "idle" | "loading" | "loaded" | "failed";

export type IntelligenceGuidedPanelProps = {
	projectId: string;
	scanRunId: string;
	exportPayload: StaticIntelligenceExportV1;
	findings: Finding[];
	findingsStatus: ResourceStatus;
	findingsError: string | null;
	hasMoreFindings: boolean;
	onReloadFindings: () => void;
	onLoadMoreFindings: () => void;
	details: Record<string, FindingDetail>;
	detailStatus: Record<string, ResourceStatus>;
	detailErrors: Record<string, string | null>;
	onLoadFinding: (findingId: string, force?: boolean) => Promise<void>;
	onSaveDecision: (
		findingId: string,
		input: {
			decision: GuidedDecision;
			reason: FindingDecision["reason"];
			comment?: string;
			linkedReviewId?: string;
		},
	) => Promise<FindingDecision>;
};
