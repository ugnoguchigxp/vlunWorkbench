import { useRef, useState } from "react";
import type {
	DynamicArtifact,
	DynamicEvidence,
	DynamicProfileConfig,
	DynamicRun,
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingGroup,
	FindingReview,
	ReproductionArtifact,
	ReproductionEvidence,
	ReproductionProfile,
	ReproductionRun,
	ScanRunSummary,
} from "../../../api";
import type {
	RemediationPriority,
	RemediationStatus,
} from "../remediation-plan";

export type FindingDetails = {
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
};
export type FindingSelectionBundle = {
	details: FindingDetails;
	reviews: FindingReview[];
	decisions: FindingDecision[];
};
export type FindingVerificationBundle = {
	reproductionProfiles: ReproductionProfile[];
	selectedReproductionProfile: string;
	reproductions: ReproductionRun[];
	dynamicProfiles: DynamicProfileConfig[];
	selectedDynamicProfile: string;
	dynamicRuns: DynamicRun[];
};

export function useScanFindingsState() {
	const [findings, setFindings] = useState<Finding[]>([]);
	const [findingsLoading, setFindingsLoading] = useState(false);
	const [selectedFindingId, setSelectedFindingId] = useState("");
	const [scanSummary, setScanSummary] = useState<ScanRunSummary | null>(null);
	const [scanGroups, setScanGroups] = useState<FindingGroup[]>([]);
	const [selectedGroupId, setSelectedGroupId] = useState("");
	const [findingsViewMode, setFindingsViewMode] = useState<"list" | "grouped">(
		"grouped",
	);
	const [selectedFindingDetails, setSelectedFindingDetails] =
		useState<FindingDetails | null>(null);
	const [allReviews, setAllReviews] = useState<FindingReview[]>([]);
	const [reviewLoading, setReviewLoading] = useState(false);
	const [reviewError, setReviewError] = useState<string | null>(null);
	const [allDecisions, setAllDecisions] = useState<FindingDecision[]>([]);
	const [decisionInput, setDecisionInput] =
		useState<FindingDecision["decision"]>("needs_fix");
	const [reasonInput, setReasonInput] = useState<FindingDecision["reason"]>(
		"confirmed_by_evidence",
	);
	const [commentInput, setCommentInput] = useState("");
	const [linkReviewInput, setLinkReviewInput] = useState(false);
	const [decisionSubmitLoading, setDecisionSubmitLoading] = useState(false);
	const [remediationStatusInput, setRemediationStatusInput] =
		useState<RemediationStatus>("not_started");
	const [remediationOwnerInput, setRemediationOwnerInput] = useState("");
	const [remediationPriorityInput, setRemediationPriorityInput] =
		useState<RemediationPriority>("p2");
	const [remediationDueDateInput, setRemediationDueDateInput] = useState("");
	const [remediationFixInput, setRemediationFixInput] = useState("");
	const [remediationSaveLoading, setRemediationSaveLoading] = useState(false);
	const [reproProfiles, setReproProfiles] = useState<ReproductionProfile[]>([]);
	const [reproRuns, setReproRuns] = useState<ReproductionRun[]>([]);
	const [selectedReproProfile, setSelectedReproProfile] = useState("");
	const [reproLoading, setReproLoading] = useState(false);
	const [reproError, setReproError] = useState<string | null>(null);
	const [expandedReproRunId, setExpandedReproRunId] = useState<string | null>(
		null,
	);
	const [reproRunArtifacts, setReproRunArtifacts] = useState<
		Record<string, ReproductionArtifact[]>
	>({});
	const [reproRunEvidence, setReproRunEvidence] = useState<
		Record<string, ReproductionEvidence[]>
	>({});
	const [dynamicProfiles, setDynamicProfiles] = useState<
		DynamicProfileConfig[]
	>([]);
	const [dynamicRuns, setDynamicRuns] = useState<DynamicRun[]>([]);
	const [selectedDynamicProfile, setSelectedDynamicProfile] = useState("");
	const [dynamicLoading, setDynamicLoading] = useState(false);
	const [dynamicError, setDynamicError] = useState<string | null>(null);
	const [expandedDynamicRunId, setExpandedDynamicRunId] = useState<
		string | null
	>(null);
	const [dynamicRunArtifacts, setDynamicRunArtifacts] = useState<
		Record<string, DynamicArtifact[]>
	>({});
	const [dynamicRunEvidence, setDynamicRunEvidence] = useState<
		Record<string, DynamicEvidence[]>
	>({});
	const [allowProjectScriptsConsent, setAllowProjectScriptsConsent] =
		useState(false);
	const selectedFindingIdRef = useRef(selectedFindingId);
	const linkReviewDefaultFindingRef = useRef<string | null>(null);
	const [verificationDataLoadedFindingId, setVerificationDataLoadedFindingId] =
		useState<string | null>(null);
	const findingSelectionCacheRef = useRef(
		new Map<string, FindingSelectionBundle>(),
	);
	const findingLoadInFlightRef = useRef(new Map<string, Promise<void>>());
	const findingVerificationCacheRef = useRef(
		new Map<string, FindingVerificationBundle>(),
	);
	const findingVerificationInFlightRef = useRef(
		new Map<string, Promise<void>>(),
	);
	const [baselineFindings, setBaselineFindings] = useState<Finding[] | null>(
		null,
	);
	const [baselineScanRunId, setBaselineScanRunId] = useState<string | null>(
		null,
	);

	return {
		allDecisions,
		allReviews,
		allowProjectScriptsConsent,
		baselineFindings,
		baselineScanRunId,
		commentInput,
		decisionInput,
		decisionSubmitLoading,
		dynamicError,
		dynamicLoading,
		dynamicProfiles,
		dynamicRunArtifacts,
		dynamicRunEvidence,
		dynamicRuns,
		expandedDynamicRunId,
		expandedReproRunId,
		findingLoadInFlightRef,
		findingSelectionCacheRef,
		findingVerificationCacheRef,
		findingVerificationInFlightRef,
		findings,
		findingsLoading,
		findingsViewMode,
		linkReviewDefaultFindingRef,
		linkReviewInput,
		reasonInput,
		remediationDueDateInput,
		remediationFixInput,
		remediationOwnerInput,
		remediationPriorityInput,
		remediationSaveLoading,
		remediationStatusInput,
		reproError,
		reproLoading,
		reproProfiles,
		reproRunArtifacts,
		reproRunEvidence,
		reproRuns,
		reviewError,
		reviewLoading,
		scanGroups,
		scanSummary,
		selectedDynamicProfile,
		selectedFindingDetails,
		selectedFindingId,
		selectedFindingIdRef,
		selectedGroupId,
		selectedReproProfile,
		setAllDecisions,
		setAllReviews,
		setAllowProjectScriptsConsent,
		setBaselineFindings,
		setBaselineScanRunId,
		setCommentInput,
		setDecisionInput,
		setDecisionSubmitLoading,
		setDynamicError,
		setDynamicLoading,
		setDynamicProfiles,
		setDynamicRunArtifacts,
		setDynamicRunEvidence,
		setDynamicRuns,
		setExpandedDynamicRunId,
		setExpandedReproRunId,
		setFindings,
		setFindingsLoading,
		setFindingsViewMode,
		setLinkReviewInput,
		setReasonInput,
		setRemediationDueDateInput,
		setRemediationFixInput,
		setRemediationOwnerInput,
		setRemediationPriorityInput,
		setRemediationSaveLoading,
		setRemediationStatusInput,
		setReproError,
		setReproLoading,
		setReproProfiles,
		setReproRunArtifacts,
		setReproRunEvidence,
		setReproRuns,
		setReviewError,
		setReviewLoading,
		setScanGroups,
		setScanSummary,
		setSelectedDynamicProfile,
		setSelectedFindingDetails,
		setSelectedFindingId,
		setSelectedGroupId,
		setSelectedReproProfile,
		setVerificationDataLoadedFindingId,
		verificationDataLoadedFindingId,
	};
}

export type ScanFindingsState = ReturnType<typeof useScanFindingsState>;
