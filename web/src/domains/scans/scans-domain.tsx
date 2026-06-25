import {
	AlertTriangle,
	Brain,
	CheckCircle2,
	Clock,
	Code,
	Download,
	Info,
	RefreshCw,
	Shield,
	Sparkles,
	XCircle,
} from "lucide-react";
import { MarkdownEditor } from "markdown-wysiwyg-editor";
import mermaid from "mermaid";
import { useCallback, useEffect, useState } from "react";
import {
	createFindingDecision,
	type Finding,
	type FindingDecision,
	type FindingEvidence,
	type FindingGroup,
	type FindingReview,
	fetchFinding,
	fetchFindingDecisions,
	fetchFindingReproductions,
	fetchFindingReviews,
	fetchProjects,
	fetchReproductionProfiles,
	fetchReproductionRunArtifacts,
	fetchScanFindings,
	fetchScanGroups,
	fetchScanProfiles,
	fetchScanReports,
	fetchScanSummary,
	fetchScans,
	generateScanReport,
	type Project,
	type ReproductionArtifact,
	type ReproductionEvidence,
	type ReproductionProfile,
	type ReproductionRun,
	type ScanProfile,
	type ScanReport,
	type ScanRun,
	type ScanRunSummary,
	startScan,
	triggerFindingReproduction,
	triggerFindingReview,
	fetchProjectDynamicProfiles,
	fetchFindingDynamicRuns,
	triggerFindingDynamicRun,
	fetchDynamicRunArtifacts,
	type DynamicProfileConfig,
	type DynamicRun,
	type DynamicArtifact,
	type DynamicEvidence,
	fetchProjectDastTargets,
	fetchProjectDastProfiles,
	fetchProjectDastRuns,
	saveProjectDastTarget,
	triggerProjectDastRun,
	fetchDastRunArtifacts,
	type DastTargetConfig,
	type DastProfile,
	type DastProfileConfig,
	type DastRun,
	type DastArtifact,
	type DastEvidence,
} from "../../api";
import { Button, SelectInput } from "../../ui";

type ScansDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (text: string | null) => void;
};

const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
};

export const ScansDomainSection = ({
	active,
	busy,
	runWithBusy,
	setErrorText,
}: ScansDomainSectionProps) => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedProjectId, setSelectedProjectId] = useState<string>("");
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [selectedScanRunId, setSelectedScanRunId] = useState<string>("");
	const [findings, setFindings] = useState<Finding[]>([]);
	const [selectedFindingId, setSelectedFindingId] = useState<string>("");
	const [profiles, setProfiles] = useState<ScanProfile[]>([]);
	const [selectedProfileId, setSelectedProfileId] =
		useState<string>("baseline");
	const [continueOnToolFailure, setContinueOnToolFailure] =
		useState<boolean>(true);
	const [timeoutSec, setTimeoutSec] = useState<number>(600);
	const [showRunScanForm, setShowRunScanForm] = useState<boolean>(false);
	const [isScanning, setIsScanning] = useState<boolean>(false);
	const [scanSummary, setScanSummary] = useState<ScanRunSummary | null>(null);
	const [scanGroups, setScanGroups] = useState<FindingGroup[]>([]);
	const [selectedGroupId, setSelectedGroupId] = useState<string>("");
	const [findingsViewMode, setFindingsViewMode] = useState<"list" | "grouped">(
		"list",
	);
	const [selectedFindingDetails, setSelectedFindingDetails] = useState<{
		finding: Finding;
		evidence: FindingEvidence[];
		latestReview: FindingReview | null;
		latestDecision: FindingDecision | null;
	} | null>(null);
	const [allReviews, setAllReviews] = useState<FindingReview[]>([]);
	const [reviewLoading, setReviewLoading] = useState(false);

	// Decisions state
	const [allDecisions, setAllDecisions] = useState<FindingDecision[]>([]);
	const [decisionInput, setDecisionInput] = useState<
		"accepted" | "false_positive" | "deferred" | "needs_fix"
	>("accepted");
	const [reasonInput, setReasonInput] = useState<string>(
		"confirmed_by_evidence",
	);
	const [commentInput, setCommentInput] = useState("");
	const [linkReviewInput, setLinkReviewInput] = useState(false);
	const [decisionSubmitLoading, setDecisionSubmitLoading] = useState(false);

	// Report state
	const [viewingReport, setViewingReport] = useState(false);
	const [reportLoading, setReportLoading] = useState(false);
	const [reports, setReports] = useState<ScanReport[]>([]);
	const [selectedReport, setSelectedReport] = useState<ScanReport | null>(null);
	const [reportPreviewContent, setReportPreviewContent] = useState<
		string | null
	>(null);
	const [reportTitle, setReportTitle] = useState("Security Report");
	const [includeFalsePositives, setIncludeFalsePositives] = useState(true);

	// Reproduction state
	const [reproProfiles, setReproProfiles] = useState<ReproductionProfile[]>([]);
	const [reproRuns, setReproRuns] = useState<ReproductionRun[]>([]);
	const [selectedReproProfile, setSelectedReproProfile] = useState<string>("");
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

	// Dynamic runs state
	const [dynamicProfiles, setDynamicProfiles] = useState<
		DynamicProfileConfig[]
	>([]);
	const [dynamicRuns, setDynamicRuns] = useState<DynamicRun[]>([]);
	const [selectedDynamicProfile, setSelectedDynamicProfile] =
		useState<string>("");
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

	// DAST state
	const [dastTargets, setDastTargets] = useState<DastTargetConfig[]>([]);
	const [dastProfiles, setDastProfiles] = useState<DastProfile[]>([]);
	const [dastProfileConfigs, setDastProfileConfigs] = useState<
		DastProfileConfig[]
	>([]);
	const [dastRuns, setDastRuns] = useState<DastRun[]>([]);
	const [selectedDastTargetId, setSelectedDastTargetId] = useState("");
	const [selectedDastProfileId, setSelectedDastProfileId] =
		useState("http-baseline");
	const [dastTargetName, setDastTargetName] = useState("Local app");
	const [dastTargetOrigin, setDastTargetOrigin] = useState(
		"http://127.0.0.1:5173",
	);
	const [dastLoading, setDastLoading] = useState(false);
	const [dastError, setDastError] = useState<string | null>(null);
	const [expandedDastRunId, setExpandedDastRunId] = useState<string | null>(
		null,
	);
	const [dastRunArtifacts, setDastRunArtifacts] = useState<
		Record<string, DastArtifact[]>
	>({});
	const [dastRunEvidence, setDastRunEvidence] = useState<
		Record<string, DastEvidence[]>
	>({});

	const [includeDeferred, setIncludeDeferred] = useState(true);
	const [includeUndecided, setIncludeUndecided] = useState(true);

	// Load reports when scan run changes
	useEffect(() => {
		if (!selectedScanRunId || !active) {
			setReports([]);
			setSelectedReport(null);
			setReportPreviewContent(null);
			return;
		}
		void (async () => {
			try {
				const list = await fetchScanReports(selectedScanRunId);
				setReports(list);
				if (list.length > 0) {
					setSelectedReport(list[0]);
				} else {
					setSelectedReport(null);
					setReportPreviewContent(null);
				}
			} catch (err) {
				console.error("Failed to load reports", err);
			}
		})();
	}, [selectedScanRunId, active]);

	// Load report content for preview when selectedReport changes
	useEffect(() => {
		if (!selectedReport || !active) {
			setReportPreviewContent(null);
			return;
		}
		if (selectedReport.status !== "completed") {
			setReportPreviewContent(null);
			return;
		}
		void (async () => {
			try {
				const response = await fetch(
					`/api/scan-reports/${selectedReport.id}/download`,
				);
				if (response.ok) {
					const text = await response.text();
					setReportPreviewContent(text);
				} else {
					setReportPreviewContent(null);
				}
			} catch (_err) {
				setReportPreviewContent(null);
			}
		})();
	}, [selectedReport, active]);

	const handleGenerateReport = async () => {
		if (!selectedScanRunId) return;
		setReportLoading(true);
		setErrorText(null);
		try {
			const res = await generateScanReport(selectedScanRunId, {
				format: "markdown",
				title: reportTitle,
				includeFalsePositives,
				includeDeferred,
				includeUndecided,
			});
			const list = await fetchScanReports(selectedScanRunId);
			setReports(list);
			const createdReport =
				list.find((r) => r.id === res.report.id) || res.report;
			setSelectedReport(createdReport);
			setViewingReport(true);
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Failed to generate report.",
			);
		} finally {
			setReportLoading(false);
		}
	};

	// Load projects on active
	useEffect(() => {
		if (!active) return;
		void (async () => {
			try {
				setErrorText(null);
				const projs = await fetchProjects();
				setProjects(projs);
				if (projs.length > 0 && !selectedProjectId) {
					setSelectedProjectId(projs[0].id);
				}
			} catch (err) {
				setErrorText(
					err instanceof Error ? err.message : "Failed to load projects.",
				);
			}
		})();
	}, [active, setErrorText, selectedProjectId]);

	// Load scans when selected project changes
	useEffect(() => {
		if (!selectedProjectId || !active) return;
		void (async () => {
			try {
				setErrorText(null);
				const runs = await fetchScans(selectedProjectId);
				setScanRuns(runs);
				if (runs.length > 0) {
					setSelectedScanRunId(runs[0].id);
				} else {
					setSelectedScanRunId("");
					setFindings([]);
					setSelectedFindingId("");
					setSelectedFindingDetails(null);
				}
			} catch (err) {
				setErrorText(
					err instanceof Error ? err.message : "Failed to load scans.",
				);
			}
		})();
	}, [selectedProjectId, active, setErrorText]);

	// Load DAST target/profile/run state when selected project changes
	useEffect(() => {
		if (!selectedProjectId || !active) {
			setDastTargets([]);
			setDastProfiles([]);
			setDastProfileConfigs([]);
			setDastRuns([]);
			setSelectedDastTargetId("");
			return;
		}
		void (async () => {
			try {
				const [targetsRes, profilesRes, runsRes] = await Promise.all([
					fetchProjectDastTargets(selectedProjectId),
					fetchProjectDastProfiles(selectedProjectId),
					fetchProjectDastRuns(selectedProjectId),
				]);
				setDastTargets(targetsRes.targets);
				setDastProfiles(profilesRes.profiles);
				setDastProfileConfigs(profilesRes.configs);
				setDastRuns(runsRes.dastRuns);
				const firstEnabled = targetsRes.targets.find(
					(target) => target.enabled,
				);
				setSelectedDastTargetId(firstEnabled?.id ?? "");
			} catch (err) {
				setDastError(
					err instanceof Error ? err.message : "Failed to load DAST state.",
				);
				setDastTargets([]);
				setDastProfiles([]);
				setDastProfileConfigs([]);
				setDastRuns([]);
			}
		})();
	}, [selectedProjectId, active]);

	// Load findings when selected scan run changes
	useEffect(() => {
		if (!selectedScanRunId || !active) return;
		void (async () => {
			try {
				setErrorText(null);
				const fnds = await fetchScanFindings(selectedScanRunId);
				setFindings(fnds);
				if (fnds.length > 0) {
					setSelectedFindingId(fnds[0].id);
				} else {
					setSelectedFindingId("");
					setSelectedFindingDetails(null);
				}
			} catch (err) {
				setErrorText(
					err instanceof Error ? err.message : "Failed to load findings.",
				);
			}
		})();
	}, [selectedScanRunId, active, setErrorText]);

	// Load scan profiles
	useEffect(() => {
		if (!active) return;
		fetchScanProfiles().then(setProfiles).catch(console.error);
	}, [active]);

	// Load summary & groups when selected scan run changes
	useEffect(() => {
		if (!selectedScanRunId || !active) {
			setScanSummary(null);
			setScanGroups([]);
			setSelectedGroupId("");
			return;
		}
		void (async () => {
			try {
				const summary = await fetchScanSummary(selectedScanRunId);
				setScanSummary(summary);
			} catch (err) {
				console.error("Failed to load scan summary", err);
				setScanSummary(null);
			}
			try {
				const { groups } = await fetchScanGroups(selectedScanRunId);
				setScanGroups(groups);
			} catch (err) {
				console.error("Failed to load scan groups", err);
				setScanGroups([]);
			}
		})();
	}, [selectedScanRunId, active]);

	// Helper to load finding details and history
	const loadFindingDetails = useCallback(
		async (findingId: string, quiet = false) => {
			const fetchAction = async () => {
				const res = await fetchFinding(findingId);
				setSelectedFindingDetails(res);
				try {
					const reviewsRes = await fetchFindingReviews(findingId);
					setAllReviews(reviewsRes.reviews);
				} catch (e) {
					console.error("Failed to fetch all reviews", e);
					setAllReviews([]);
				}
				try {
					const decisionsRes = await fetchFindingDecisions(findingId);
					setAllDecisions(decisionsRes.decisions);
				} catch (e) {
					console.error("Failed to fetch all decisions", e);
					setAllDecisions([]);
				}
				try {
					const profilesRes = await fetchReproductionProfiles(findingId);
					setReproProfiles(profilesRes.profiles);
					const firstApplicable = profilesRes.profiles.find(
						(p) => p.isApplicable,
					);
					setSelectedReproProfile(firstApplicable ? firstApplicable.id : "");
				} catch (e) {
					console.error("Failed to fetch reproduction profiles", e);
					setReproProfiles([]);
					setSelectedReproProfile("");
				}
				try {
					const reprosRes = await fetchFindingReproductions(findingId);
					setReproRuns(reprosRes.reproductions);
				} catch (e) {
					console.error("Failed to fetch reproduction runs", e);
					setReproRuns([]);
				}
				try {
					const profilesRes = await fetchProjectDynamicProfiles(
						res.finding.projectId,
					);
					setDynamicProfiles(profilesRes.configs);
					const firstEnabled = profilesRes.configs.find((p) => p.enabled);
					setSelectedDynamicProfile(firstEnabled ? firstEnabled.profileId : "");
				} catch (e) {
					console.error("Failed to fetch dynamic profiles", e);
					setDynamicProfiles([]);
					setSelectedDynamicProfile("");
				}
				try {
					const runsRes = await fetchFindingDynamicRuns(findingId);
					setDynamicRuns(runsRes.dynamicRuns);
				} catch (e) {
					console.error("Failed to fetch dynamic runs", e);
					setDynamicRuns([]);
				}
			};

			if (quiet) {
				try {
					await fetchAction();
				} catch (err) {
					console.error("Failed to silently reload finding details:", err);
				}
			} else {
				await runWithBusy(fetchAction);
			}
		},
		[runWithBusy],
	);

	// Load finding details when finding selection changes
	useEffect(() => {
		if (!selectedFindingId || !active) return;
		void loadFindingDetails(selectedFindingId);
	}, [selectedFindingId, active, loadFindingDetails]);

	// Reset form state when selected finding changes
	useEffect(() => {
		if (selectedFindingId) {
			setDecisionInput("accepted");
			setReasonInput("confirmed_by_evidence");
			setCommentInput("");
			setLinkReviewInput(false);
		}
	}, [selectedFindingId]);

	const handleDecisionSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedFindingId) return;

		setErrorText(null);
		setDecisionSubmitLoading(true);
		try {
			const params: {
				decision: "accepted" | "false_positive" | "deferred" | "needs_fix";
				reason: string;
				comment?: string;
				linkedReviewId?: string;
			} = {
				decision: decisionInput,
				reason: reasonInput,
				comment: commentInput || undefined,
			};

			if (linkReviewInput && selectedFindingDetails?.latestReview) {
				params.linkedReviewId = selectedFindingDetails.latestReview.id;
			}

			await createFindingDecision(selectedFindingId, params);

			// Reload finding details, history, and the findings list to update badges
			await loadFindingDetails(selectedFindingId, true);
			const fnds = await fetchScanFindings(selectedScanRunId);
			setFindings(fnds);

			// Clear comment input after success
			setCommentInput("");
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Failed to record decision.",
			);
		} finally {
			setDecisionSubmitLoading(false);
		}
	};

	// Polling loop for active review
	useEffect(() => {
		if (!selectedFindingId || !active) return;

		let isMounted = true;
		let pollInterval: ReturnType<typeof setInterval> | null = null;

		const poll = async () => {
			try {
				const res = await fetchFinding(selectedFindingId);
				if (!isMounted) return;

				setSelectedFindingDetails(res);

				// If the latest review is done (no longer running), stop polling
				if (res.latestReview?.status !== "running") {
					if (pollInterval) {
						clearInterval(pollInterval);
						pollInterval = null;
					}
					// Also refresh the history list
					const reviewsRes = await fetchFindingReviews(selectedFindingId);
					if (isMounted) {
						setAllReviews(reviewsRes.reviews);
					}
				}
			} catch (error) {
				console.error("Failed to poll finding review:", error);
			}
		};

		if (selectedFindingDetails?.latestReview?.status === "running") {
			pollInterval = setInterval(poll, 2500);
		}

		return () => {
			isMounted = false;
			if (pollInterval) {
				clearInterval(pollInterval);
			}
		};
	}, [selectedFindingId, selectedFindingDetails?.latestReview?.status, active]);

	const handleTriggerReview = async () => {
		if (!selectedFindingId) return;
		setErrorText(null);
		setReviewLoading(true);
		try {
			const res = await triggerFindingReview(selectedFindingId);
			if (res.ok) {
				// Refresh finding details immediately
				await loadFindingDetails(selectedFindingId, true);
			} else {
				setErrorText(res.error || "Failed to trigger LLM review.");
			}
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Failed to trigger LLM review.",
			);
		} finally {
			setReviewLoading(false);
		}
	};

	const handleTriggerReproduction = async () => {
		if (!selectedFindingId || !selectedReproProfile) return;
		setReproLoading(true);
		setReproError(null);
		try {
			const res = await triggerFindingReproduction(selectedFindingId, {
				profileId: selectedReproProfile,
			});
			if (res.reproductionRunId) {
				setExpandedReproRunId(res.reproductionRunId);
				try {
					const artRes = await fetchReproductionRunArtifacts(
						res.reproductionRunId,
					);
					setReproRunArtifacts((prev) => ({
						...prev,
						[res.reproductionRunId]: artRes.artifacts,
					}));
					setReproRunEvidence((prev) => ({
						...prev,
						[res.reproductionRunId]: artRes.evidence,
					}));
				} catch (e) {
					console.error("Failed to load artifacts/evidence for new run", e);
				}
			}
			const reprosRes = await fetchFindingReproductions(selectedFindingId);
			setReproRuns(reprosRes.reproductions);
		} catch (err: any) {
			console.error("Failed to trigger reproduction", err);
			setReproError(
				err.message ||
					"An unexpected error occurred during reproduction execution.",
			);
		} finally {
			setReproLoading(false);
		}
	};

	const handleToggleReproRun = async (runId: string) => {
		if (expandedReproRunId === runId) {
			setExpandedReproRunId(null);
			return;
		}
		setExpandedReproRunId(runId);
		if (!reproRunArtifacts[runId]) {
			try {
				const artRes = await fetchReproductionRunArtifacts(runId);
				setReproRunArtifacts((prev) => ({
					...prev,
					[runId]: artRes.artifacts,
				}));
				setReproRunEvidence((prev) => ({ ...prev, [runId]: artRes.evidence }));
			} catch (e) {
				console.error("Failed to fetch artifacts/evidence for run", e);
			}
		}
	};

	const handleTriggerDynamic = async () => {
		if (!selectedFindingId || !selectedDynamicProfile) return;

		const profile = dynamicProfiles.find(
			(p) => p.profileId === selectedDynamicProfile,
		);
		if (profile?.allowProjectScripts && !allowProjectScriptsConsent) {
			setDynamicError(
				"You must give explicit consent to run project scripts inside the Docker sandbox.",
			);
			return;
		}

		setDynamicLoading(true);
		setDynamicError(null);
		try {
			const res = await triggerFindingDynamicRun(selectedFindingId, {
				profileId: selectedDynamicProfile,
			});
			if (res.dynamicRunId) {
				setExpandedDynamicRunId(res.dynamicRunId);
				try {
					const artRes = await fetchDynamicRunArtifacts(res.dynamicRunId);
					setDynamicRunArtifacts((prev) => ({
						...prev,
						[res.dynamicRunId]: artRes.artifacts,
					}));
					setDynamicRunEvidence((prev) => ({
						...prev,
						[res.dynamicRunId]: artRes.evidence,
					}));
				} catch (e) {
					console.error("Failed to load artifacts/evidence for new run", e);
				}
			}
			const runsRes = await fetchFindingDynamicRuns(selectedFindingId);
			setDynamicRuns(runsRes.dynamicRuns);
		} catch (err: any) {
			console.error("Failed to trigger dynamic check", err);
			setDynamicError(
				err.message ||
					"An unexpected error occurred during dynamic check execution.",
			);
		} finally {
			setDynamicLoading(false);
		}
	};

	const handleToggleDynamicRun = async (runId: string) => {
		if (expandedDynamicRunId === runId) {
			setExpandedDynamicRunId(null);
			return;
		}
		setExpandedDynamicRunId(runId);
		if (!dynamicRunArtifacts[runId]) {
			try {
				const artRes = await fetchDynamicRunArtifacts(runId);
				setDynamicRunArtifacts((prev) => ({
					...prev,
					[runId]: artRes.artifacts,
				}));
				setDynamicRunEvidence((prev) => ({
					...prev,
					[runId]: artRes.evidence,
				}));
			} catch (e) {
				console.error("Failed to fetch artifacts/evidence for run", e);
			}
		}
	};

	const refreshDastRuns = async () => {
		if (!selectedProjectId) return;
		const runsRes = await fetchProjectDastRuns(selectedProjectId);
		setDastRuns(runsRes.dastRuns);
	};

	const handleCreateDastTarget = async () => {
		if (!selectedProjectId) return;
		setDastLoading(true);
		setDastError(null);
		try {
			const res = await saveProjectDastTarget(selectedProjectId, {
				name: dastTargetName,
				origin: dastTargetOrigin,
				allowedPathsJson: ["/"],
				maxDepth: 0,
				maxRequests: 20,
				rateLimitPerSec: 2,
				timeoutSec: 120,
			});
			const targetsRes = await fetchProjectDastTargets(selectedProjectId);
			setDastTargets(targetsRes.targets);
			setSelectedDastTargetId(res.target.id);
		} catch (err) {
			setDastError(
				err instanceof Error ? err.message : "Failed to save DAST target.",
			);
		} finally {
			setDastLoading(false);
		}
	};

	const handleTriggerDastRun = async () => {
		if (!selectedProjectId || !selectedDastTargetId || !selectedDastProfileId) {
			return;
		}
		setDastLoading(true);
		setDastError(null);
		try {
			const profileConfig = dastProfileConfigs.find(
				(config) =>
					config.profileId === selectedDastProfileId &&
					config.targetConfigId === selectedDastTargetId &&
					config.enabled,
			);
			const res = await triggerProjectDastRun(selectedProjectId, {
				targetConfigId: selectedDastTargetId,
				profileId: selectedDastProfileId,
				profileConfigId: profileConfig?.id,
				runner: "host",
			});
			await refreshDastRuns();
			if (res.dastRunId) {
				setExpandedDastRunId(res.dastRunId);
				const artifactsRes = await fetchDastRunArtifacts(res.dastRunId);
				setDastRunArtifacts((prev) => ({
					...prev,
					[res.dastRunId as string]: artifactsRes.artifacts,
				}));
				setDastRunEvidence((prev) => ({
					...prev,
					[res.dastRunId as string]: artifactsRes.evidence,
				}));
			}
			if (res.scanRunId) {
				const runs = await fetchScans(selectedProjectId);
				setScanRuns(runs);
				setSelectedScanRunId(res.scanRunId);
			}
		} catch (err) {
			setDastError(
				err instanceof Error ? err.message : "Failed to run DAST profile.",
			);
		} finally {
			setDastLoading(false);
		}
	};

	const handleToggleDastRun = async (runId: string) => {
		if (expandedDastRunId === runId) {
			setExpandedDastRunId(null);
			return;
		}
		setExpandedDastRunId(runId);
		if (!dastRunArtifacts[runId]) {
			try {
				const artifactsRes = await fetchDastRunArtifacts(runId);
				setDastRunArtifacts((prev) => ({
					...prev,
					[runId]: artifactsRes.artifacts,
				}));
				setDastRunEvidence((prev) => ({
					...prev,
					[runId]: artifactsRes.evidence,
				}));
			} catch (err) {
				setDastError(
					err instanceof Error ? err.message : "Failed to load DAST artifacts.",
				);
			}
		}
	};

	const getSeverityClass = (sev: string | null | undefined): string => {
		const s = (sev || "unknown").toLowerCase();
		if (s === "critical") return "sev-critical";
		if (s === "high") return "sev-high";
		if (s === "medium") return "sev-medium";
		if (s === "low") return "sev-low";
		return "sev-info";
	};

	const getStatusIcon = (status: string) => {
		if (status === "completed")
			return <CheckCircle2 className="icon text-emerald-600" />;
		if (status === "failed") return <XCircle className="icon text-red-600" />;
		if (status === "running")
			return <Clock className="icon text-yellow-600 animate-spin" />;
		return <Clock className="icon text-slate-400" />;
	};

	if (!active) return null;

	const displayedFindings =
		findingsViewMode === "grouped" && selectedGroupId
			? findings.filter((f) => {
					const group = scanGroups.find((g) => g.id === selectedGroupId);
					return group ? group.findingIds.includes(f.id) : true;
				})
			: findings;

	return (
		<main className="scans-layout">
			{/* Project and Scan Run Selector */}
			<section className="scans-panel">
				<div className="scans-panel-header">
					<h2>Scans</h2>
					<div className="form-stack" style={{ padding: 0 }}>
						<label htmlFor="project-select">
							<span>Select Project</span>
							<SelectInput
								id="project-select"
								value={selectedProjectId}
								onChange={(e) => setSelectedProjectId(e.target.value)}
							>
								<option value="" disabled>
									-- Select Project --
								</option>
								{projects.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</SelectInput>
						</label>
					</div>
					{selectedProjectId && (
						<div style={{ marginTop: "12px" }}>
							<Button
								type="button"
								variant="secondary"
								onClick={() => setShowRunScanForm(!showRunScanForm)}
								style={{
									width: "100%",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									gap: "6px",
								}}
								disabled={isScanning}
							>
								<Sparkles
									className="icon text-indigo-600"
									style={{ width: "14px", height: "14px" }}
								/>
								{showRunScanForm
									? "Hide Run Scan Settings"
									: "Run New Scan Profile"}
							</Button>
						</div>
					)}
				</div>

				{showRunScanForm && selectedProjectId && (
					<div
						style={{
							padding: "16px",
							borderBottom: "1px solid #e2e8f0",
							background: "#f8fafc",
						}}
					>
						<div className="form-stack" style={{ gap: "10px", padding: 0 }}>
							<label htmlFor="profile-select">
								<span
									style={{
										fontSize: "12px",
										fontWeight: "600",
										color: "#475569",
									}}
								>
									Scan Profile
								</span>
								<select
									id="profile-select"
									value={selectedProfileId}
									onChange={(e) => setSelectedProfileId(e.target.value)}
									style={{
										width: "100%",
										padding: "8px",
										borderRadius: "6px",
										border: "1px solid #cbd5e1",
										background: "#fff",
										fontSize: "13px",
									}}
								>
									{profiles.map((p) => (
										<option key={p.id} value={p.id}>
											{p.name}
										</option>
									))}
								</select>
							</label>

							{selectedProfileId &&
								profiles.find((p) => p.id === selectedProfileId) && (
									<div
										style={{
											fontSize: "11px",
											color: "#64748b",
											marginTop: "-4px",
										}}
									>
										{
											profiles.find((p) => p.id === selectedProfileId)
												?.description
										}
										<div style={{ marginTop: "4px", fontWeight: "600" }}>
											Tools:{" "}
											{profiles
												.find((p) => p.id === selectedProfileId)
												?.tools.map((t: any) => t.displayName)
												.join(", ")}
										</div>
									</div>
								)}

							<div style={{ display: "flex", gap: "10px" }}>
								<label htmlFor="timeout-input" style={{ flex: 1 }}>
									<span
										style={{
											fontSize: "11px",
											fontWeight: "600",
											color: "#475569",
										}}
									>
										Timeout (sec)
									</span>
									<input
										id="timeout-input"
										type="number"
										value={timeoutSec}
										onChange={(e) => setTimeoutSec(Number(e.target.value))}
										style={{
											width: "100%",
											padding: "6px 8px",
											borderRadius: "6px",
											border: "1px solid #cbd5e1",
											fontSize: "13px",
										}}
									/>
								</label>

								<label
									style={{
										display: "flex",
										alignItems: "center",
										gap: "6px",
										flex: 1,
										marginTop: "20px",
										cursor: "pointer",
									}}
								>
									<input
										type="checkbox"
										checked={continueOnToolFailure}
										onChange={(e) => setContinueOnToolFailure(e.target.checked)}
									/>
									<span
										style={{
											fontSize: "11px",
											fontWeight: "600",
											color: "#475569",
										}}
									>
										Continue on Fail
									</span>
								</label>
							</div>

							<Button
								type="button"
								variant="primary"
								onClick={async () => {
									setIsScanning(true);
									setErrorText(null);
									try {
										const res = await startScan(selectedProjectId, {
											profile: selectedProfileId,
											continueOnToolFailure,
											timeoutSec,
										});
										// Refresh scans list
										const runs = await fetchScans(selectedProjectId);
										setScanRuns(runs);
										if (res.scan?.id) {
											setSelectedScanRunId(res.scan.id);
											// Reset findings & details
											setSelectedFindingId("");
											setSelectedFindingDetails(null);
										}
										setShowRunScanForm(false);
									} catch (err: any) {
										setErrorText(err.message || "Scan failed to run.");
									} finally {
										setIsScanning(false);
									}
								}}
								disabled={isScanning}
								style={{ width: "100%", marginTop: "5px" }}
							>
								{isScanning ? "Running Scan Profile..." : "Start Profile Scan"}
							</Button>
						</div>
					</div>
				)}

				{selectedProjectId && (
					<div
						style={{
							padding: "16px",
							borderBottom: "1px solid #e2e8f0",
							background: "#fff",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								marginBottom: "12px",
							}}
						>
							<Shield
								className="icon text-teal-700"
								style={{ width: "18px", height: "18px" }}
							/>
							<h3
								style={{
									fontSize: "15px",
									fontWeight: "700",
									color: "#0f172a",
									margin: 0,
								}}
							>
								DAST
							</h3>
						</div>

						{dastError && (
							<div
								style={{
									background: "#fef2f2",
									border: "1px solid #fee2e2",
									borderRadius: "8px",
									padding: "10px 12px",
									color: "#b91c1c",
									fontSize: "12px",
									marginBottom: "12px",
								}}
							>
								{dastError}
							</div>
						)}

						<div className="form-stack" style={{ padding: 0, gap: "10px" }}>
							<label htmlFor="dast-target-name">
								<span>Target Name</span>
								<input
									id="dast-target-name"
									value={dastTargetName}
									onChange={(e) => setDastTargetName(e.target.value)}
									style={{
										width: "100%",
										padding: "8px",
										borderRadius: "6px",
										border: "1px solid #cbd5e1",
										fontSize: "13px",
									}}
								/>
							</label>
							<label htmlFor="dast-target-origin">
								<span>Local Target Origin</span>
								<input
									id="dast-target-origin"
									value={dastTargetOrigin}
									onChange={(e) => setDastTargetOrigin(e.target.value)}
									placeholder="http://127.0.0.1:5173"
									style={{
										width: "100%",
										padding: "8px",
										borderRadius: "6px",
										border: "1px solid #cbd5e1",
										fontSize: "13px",
									}}
								/>
							</label>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void handleCreateDastTarget()}
								disabled={dastLoading || !dastTargetName || !dastTargetOrigin}
								style={{ width: "100%" }}
							>
								Save DAST Target
							</Button>

							<label htmlFor="dast-target-select">
								<span>Saved Target</span>
								<SelectInput
									id="dast-target-select"
									value={selectedDastTargetId}
									onChange={(e) => setSelectedDastTargetId(e.target.value)}
								>
									<option value="">-- Select Target --</option>
									{dastTargets.map((target) => (
										<option
											key={target.id}
											value={target.id}
											disabled={!target.enabled}
										>
											{target.name} ({target.normalizedOrigin})
										</option>
									))}
								</SelectInput>
							</label>
							<label htmlFor="dast-profile-select">
								<span>DAST Profile</span>
								<SelectInput
									id="dast-profile-select"
									value={selectedDastProfileId}
									onChange={(e) => setSelectedDastProfileId(e.target.value)}
								>
									{dastProfiles
										.filter(
											(profile) =>
												profile.enabled &&
												(profile.id === "http-baseline" ||
													dastProfileConfigs.some(
														(config) =>
															config.profileId === profile.id &&
															config.targetConfigId === selectedDastTargetId &&
															config.enabled,
													)),
										)
										.map((profile) => (
											<option key={profile.id} value={profile.id}>
												{profile.displayName}
											</option>
										))}
								</SelectInput>
							</label>
							<Button
								type="button"
								variant="primary"
								onClick={() => void handleTriggerDastRun()}
								disabled={
									dastLoading || !selectedDastTargetId || !selectedDastProfileId
								}
								style={{ width: "100%" }}
							>
								{dastLoading ? "Running DAST..." : "Run HTTP Baseline"}
							</Button>
						</div>

						{dastRuns.length > 0 && (
							<div
								style={{
									marginTop: "14px",
									display: "flex",
									flexDirection: "column",
									gap: "8px",
								}}
							>
								<h4
									style={{
										fontSize: "12px",
										fontWeight: "700",
										color: "#475569",
										margin: 0,
									}}
								>
									DAST Runs ({dastRuns.length})
								</h4>
								{dastRuns.slice(0, 5).map((run) => {
									const artifacts = dastRunArtifacts[run.id] ?? [];
									const evidence = dastRunEvidence[run.id] ?? [];
									const expanded = expandedDastRunId === run.id;
									return (
										<div
											key={run.id}
											style={{
												border: "1px solid #e2e8f0",
												borderRadius: "8px",
												overflow: "hidden",
											}}
										>
											<button
												type="button"
												onClick={() => void handleToggleDastRun(run.id)}
												style={{
													width: "100%",
													border: 0,
													background: "#f8fafc",
													padding: "10px",
													cursor: "pointer",
													textAlign: "left",
													display: "flex",
													justifyContent: "space-between",
													gap: "8px",
													font: "inherit",
												}}
											>
												<span style={{ fontSize: "13px", fontWeight: "600" }}>
													{run.profileId}
												</span>
												<span
													className={`scan-status-badge badge-${run.status}`}
													style={{ textTransform: "capitalize" }}
												>
													{run.outcome ?? run.status}
												</span>
											</button>
											{expanded && (
												<div style={{ padding: "10px", fontSize: "12px" }}>
													{run.summary && (
														<div
															style={{ marginBottom: "8px", color: "#334155" }}
														>
															{run.summary}
														</div>
													)}
													{evidence.length > 0 && (
														<div style={{ marginBottom: "8px" }}>
															<strong>Evidence</strong>
															{evidence.map((item) => (
																<div key={item.id} style={{ marginTop: "4px" }}>
																	{item.title}
																</div>
															))}
														</div>
													)}
													{artifacts.length > 0 && (
														<div
															style={{
																display: "flex",
																flexWrap: "wrap",
																gap: "6px",
															}}
														>
															{artifacts.map((artifact) => (
																<a
																	key={artifact.id}
																	href={`/api/dast-runs/${run.id}/artifacts/${artifact.id}`}
																	target="_blank"
																	rel="noreferrer"
																	style={{
																		display: "inline-flex",
																		alignItems: "center",
																		gap: "5px",
																		padding: "5px 8px",
																		border: "1px solid #cbd5e1",
																		borderRadius: "6px",
																		color: "#2563eb",
																		textDecoration: "none",
																	}}
																>
																	<Download
																		style={{ width: "12px", height: "12px" }}
																	/>
																	{artifact.kind}
																</a>
															))}
														</div>
													)}
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}

				<div className="scans-list">
					{scanRuns.length > 0 ? (
						scanRuns.map((run) => (
							<button
								key={run.id}
								type="button"
								className={`scan-item ${
									selectedScanRunId === run.id ? "active" : ""
								}`}
								onClick={() => setSelectedScanRunId(run.id)}
							>
								<div className="finding-meta-row">
									<strong style={{ fontSize: "14px", color: "#1e293b" }}>
										{run.profile}
									</strong>
									<span
										className={`scan-status-badge badge-${
											run.status || "queued"
										}`}
									>
										{run.status || "queued"}
									</span>
								</div>
								<small>{formatDateTime(run.createdAt)}</small>
							</button>
						))
					) : (
						<div className="tree-info" style={{ padding: "20px" }}>
							No scans found for this project.
						</div>
					)}
				</div>
				{selectedScanRunId && (
					<div
						className="scans-report-subpanel"
						style={{
							borderTop: "1px solid #f1f5f9",
							padding: "16px",
							background: "#f8fafc",
						}}
					>
						<h3
							style={{
								margin: "0 0 10px 0",
								fontSize: "14px",
								fontWeight: "700",
								color: "#0f172a",
							}}
						>
							Scan Report
						</h3>
						<div className="form-stack" style={{ gap: "8px" }}>
							<label
								style={{ display: "flex", flexDirection: "column", gap: "4px" }}
							>
								<span
									style={{
										fontSize: "12px",
										fontWeight: "600",
										color: "#475569",
									}}
								>
									Report Title
								</span>
								<input
									type="text"
									value={reportTitle}
									onChange={(e) => setReportTitle(e.target.value)}
									style={{
										padding: "6px 10px",
										fontSize: "13px",
										border: "1px solid #cbd5e1",
										borderRadius: "6px",
										width: "100%",
									}}
								/>
							</label>

							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: "6px",
									margin: "5px 0",
								}}
							>
								<label
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										fontSize: "12px",
										color: "#334155",
									}}
								>
									<input
										type="checkbox"
										checked={includeFalsePositives}
										onChange={(e) => setIncludeFalsePositives(e.target.checked)}
									/>
									Include False Positives
								</label>
								<label
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										fontSize: "12px",
										color: "#334155",
									}}
								>
									<input
										type="checkbox"
										checked={includeDeferred}
										onChange={(e) => setIncludeDeferred(e.target.checked)}
									/>
									Include Deferred
								</label>
								<label
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										fontSize: "12px",
										color: "#334155",
									}}
								>
									<input
										type="checkbox"
										checked={includeUndecided}
										onChange={(e) => setIncludeUndecided(e.target.checked)}
									/>
									Include Undecided
								</label>
							</div>

							<div style={{ display: "flex", gap: "8px" }}>
								<Button
									type="button"
									variant="primary"
									onClick={handleGenerateReport}
									disabled={reportLoading || busy}
									style={{ flex: 1, padding: "8px", fontSize: "12px" }}
								>
									{reportLoading ? "Generating..." : "Generate"}
								</Button>
								{reports.length > 0 && (
									<Button
										type="button"
										variant="secondary"
										onClick={() => {
											if (reports[0]) {
												setSelectedReport(reports[0]);
												setViewingReport(true);
											}
										}}
										style={{ padding: "8px", fontSize: "12px" }}
									>
										View Latest
									</Button>
								)}
							</div>
						</div>
					</div>
				)}
			</section>

			{/* Findings List */}
			<section className="scans-panel">
				<div className="scans-panel-header">
					<h2>Findings</h2>
					<small style={{ color: "#64748b" }}>
						{displayedFindings.length} findings shown ({findings.length} total)
					</small>
				</div>

				<div
					style={{
						display: "flex",
						gap: "8px",
						padding: "0 16px 10px 16px",
						borderBottom: "1px solid #e2e8f0",
					}}
				>
					<button
						type="button"
						className={`button ${findingsViewMode === "list" ? "button-primary" : "button-secondary"}`}
						onClick={() => {
							setFindingsViewMode("list");
							setSelectedGroupId("");
						}}
						style={{
							padding: "4px 8px",
							fontSize: "12px",
							flex: 1,
							border: "1px solid #cbd5e1",
							borderRadius: "6px",
							cursor: "pointer",
							background: findingsViewMode === "list" ? "#0f172a" : "#fff",
							color: findingsViewMode === "list" ? "#fff" : "#0f172a",
						}}
					>
						List View ({findings.length})
					</button>
					<button
						type="button"
						className={`button ${findingsViewMode === "grouped" ? "button-primary" : "button-secondary"}`}
						onClick={() => setFindingsViewMode("grouped")}
						style={{
							padding: "4px 8px",
							fontSize: "12px",
							flex: 1,
							border: "1px solid #cbd5e1",
							borderRadius: "6px",
							cursor: "pointer",
							background: findingsViewMode === "grouped" ? "#0f172a" : "#fff",
							color: findingsViewMode === "grouped" ? "#fff" : "#0f172a",
						}}
					>
						Grouped View ({scanGroups.length})
					</button>
				</div>

				{findingsViewMode === "grouped" && scanGroups.length > 0 && (
					<div
						style={{ padding: "10px 16px", borderBottom: "1px solid #e2e8f0" }}
					>
						<label
							htmlFor="group-select"
							style={{
								fontSize: "12px",
								fontWeight: "600",
								color: "#475569",
								display: "block",
								marginBottom: "4px",
							}}
						>
							Select Group
						</label>
						<SelectInput
							id="group-select"
							value={selectedGroupId}
							onChange={(e) => setSelectedGroupId(e.target.value)}
						>
							<option value="">-- All Groups --</option>
							{scanGroups.map((g) => (
								<option key={g.id} value={g.id}>
									[{g.severity.toUpperCase()}] {g.title} ({g.findingIds.length})
								</option>
							))}
						</SelectInput>
					</div>
				)}

				<div className="scans-list">
					{displayedFindings.length > 0 ? (
						displayedFindings.map((fnd) => (
							<button
								key={fnd.id}
								type="button"
								className={`finding-item ${
									selectedFindingId === fnd.id ? "active" : ""
								}`}
								onClick={() => {
									setSelectedFindingId(fnd.id);
									setViewingReport(false);
								}}
							>
								<div className="finding-meta-row">
									<span
										className={`severity-badge ${getSeverityClass(fnd.severity)}`}
									>
										{fnd.severity}
									</span>
									<span style={{ fontSize: "11px", color: "#64748b" }}>
										{fnd.sourceTool}
									</span>
									{fnd.latestDecision?.decision ? (
										<span
											className={`decision-badge badge-${fnd.latestDecision.decision}`}
											style={{ marginLeft: "auto" }}
										>
											{fnd.latestDecision.decision.replace("_", " ")}
										</span>
									) : (
										<span
											className="decision-badge badge-open"
											style={{ marginLeft: "auto" }}
										>
											Open
										</span>
									)}
								</div>
								<h4 className="finding-title">{fnd.title}</h4>
								{fnd.primaryLocation?.path ? (
									<div className="finding-loc">
										{typeof fnd.primaryLocation.path === "string"
											? fnd.primaryLocation.path.split("/").slice(-2).join("/")
											: ""}
										{fnd.primaryLocation.startLine
											? `:${fnd.primaryLocation.startLine}`
											: ""}
									</div>
								) : null}
							</button>
						))
					) : (
						<div className="tree-info" style={{ padding: "20px" }}>
							Select a scan run to view findings.
						</div>
					)}
				</div>
			</section>

			{/* Finding Details & LLM Review Details */}
			<section className="scans-panel scans-detail-col">
				{viewingReport ? (
					<>
						<div
							className="scans-panel-header"
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
								justifyContent: "space-between",
							}}
						>
							<h2>
								{selectedReport
									? `Report: ${selectedReport.title}`
									: "Scan Report"}
							</h2>
							<Button
								type="button"
								variant="secondary"
								onClick={() => setViewingReport(false)}
							>
								Back to Findings
							</Button>
						</div>
						<div className="scans-detail-scroll" style={{ padding: "20px" }}>
							{selectedReport ? (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "15px",
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "10px",
										}}
									>
										<span
											className={`scan-status-badge badge-${selectedReport.status}`}
										>
											Status: {selectedReport.status}
										</span>
										<small style={{ color: "#64748b" }}>
											Created: {formatDateTime(selectedReport.createdAt as any)}
										</small>
										{selectedReport.status === "completed" && (
											<a
												href={`/api/scan-reports/${selectedReport.id}/download`}
												download
												className="button button-primary"
												style={{
													marginLeft: "auto",
													textDecoration: "none",
													display: "inline-flex",
													alignItems: "center",
													gap: "5px",
													padding: "6px 12px",
													background: "#0f172a",
													color: "#fff",
													borderRadius: "6px",
													fontSize: "13px",
													fontWeight: "600",
												}}
											>
												<Download size={14} /> Download Report
											</a>
										)}
									</div>
									{selectedReport.status === "running" && (
										<div
											style={{
												padding: "40px",
												textAlign: "center",
												color: "#64748b",
											}}
										>
											<RefreshCw
												className="animate-spin"
												style={{ margin: "0 auto 10px", display: "block" }}
											/>
											Generating report...
										</div>
									)}
									{selectedReport.status === "failed" && (
										<div
											style={{
												padding: "20px",
												background: "#fef2f2",
												border: "1px solid #fca5a5",
												borderRadius: "8px",
												color: "#b91c1c",
											}}
										>
											<strong>Generation Failed</strong>
											<p
												style={{
													marginTop: "5px",
													marginBottom: 0,
													fontSize: "13px",
												}}
											>
												{selectedReport.errorMessage}
											</p>
										</div>
									)}
									{selectedReport.status === "completed" &&
									reportPreviewContent ? (
										<div
											className="artifact-renderer"
											style={{
												border: "1px solid #e2e8f0",
												borderRadius: "8px",
												padding: "16px",
												background: "#fff",
											}}
										>
											<MarkdownEditor
												value={reportPreviewContent}
												editable={false}
												enableMermaid={true}
												mermaidLib={mermaid}
												toolbarMode="hidden"
												autoHeight={true}
												className="wysiwyg-viewer"
											/>
										</div>
									) : selectedReport.status === "completed" ? (
										<div
											style={{
												padding: "20px",
												textAlign: "center",
												color: "#64748b",
											}}
										>
											Loading report preview...
										</div>
									) : null}
								</div>
							) : (
								<div
									style={{
										padding: "40px",
										textAlign: "center",
										color: "#64748b",
									}}
								>
									No report selected.
								</div>
							)}
						</div>
					</>
				) : (
					<>
						<div className="scans-panel-header">
							<h2>Finding Analysis & LLM Review</h2>
						</div>

						{selectedFindingDetails ? (
							<div className="scans-detail-scroll">
								{/* Title Section */}
								<div className="detail-section">
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "10px",
											flexWrap: "wrap",
										}}
									>
										<span
											className={`severity-badge ${getSeverityClass(
												selectedFindingDetails.finding.severity,
											)}`}
											style={{ fontSize: "12px", padding: "4px 8px" }}
										>
											{selectedFindingDetails.finding.severity}
										</span>
										<span
											style={{
												fontSize: "13px",
												fontWeight: "600",
												color: "#475569",
											}}
										>
											Tool: {selectedFindingDetails.finding.sourceTool}
										</span>
										<span
											style={{
												fontSize: "13px",
												color: "#64748b",
												fontFamily: "monospace",
											}}
										>
											Rule: {selectedFindingDetails.finding.ruleId}
										</span>
									</div>
									<h1
										style={{
											margin: "8px 0 4px",
											fontSize: "20px",
											fontWeight: "800",
											color: "#0f172a",
											lineHeight: "1.3",
										}}
									>
										{selectedFindingDetails.finding.title}
									</h1>
									<p style={{ margin: 0, fontSize: "14px", color: "#334155" }}>
										{selectedFindingDetails.finding.description}
									</p>
								</div>

								{/* Primary Location and Evidence Code Snippet */}
								{selectedFindingDetails.finding.primaryLocation ? (
									<div className="detail-section">
										<h3 className="detail-section-title">Primary Location</h3>
										<div className="code-snippet-box">
											<div className="code-snippet-header">
												<div className="code-snippet-title">
													{String(
														selectedFindingDetails.finding.primaryLocation.path,
													)}
													{selectedFindingDetails.finding.primaryLocation
														.startLine
														? `#L${selectedFindingDetails.finding.primaryLocation.startLine}`
														: ""}
													{selectedFindingDetails.finding.primaryLocation
														.endLine &&
													selectedFindingDetails.finding.primaryLocation
														.endLine !==
														selectedFindingDetails.finding.primaryLocation
															.startLine
														? `-L${selectedFindingDetails.finding.primaryLocation.endLine}`
														: ""}
												</div>
											</div>
											<pre className="code-snippet-body">
												<code>
													{selectedFindingDetails.evidence.find(
														(ev) => ev.kind === "source-location" && ev.snippet,
													)?.snippet ||
														(typeof selectedFindingDetails.finding.metadata
															?.snippet === "string"
															? selectedFindingDetails.finding.metadata.snippet
															: "") ||
														"// Snippet not available"}
												</code>
											</pre>
										</div>
									</div>
								) : null}

								{/* Primary Evidence Artifacts */}
								{selectedFindingDetails.evidence.some((ev) => ev.artifactId) ? (
									<div className="detail-section">
										<h3 className="detail-section-title">
											Primary Scan Evidence Artifacts
										</h3>
										<div
											style={{
												display: "flex",
												gap: "8px",
												flexWrap: "wrap",
												marginTop: "8px",
											}}
										>
											{selectedFindingDetails.evidence
												.filter((ev) => ev.artifactId)
												.map((ev) => (
													<a
														key={ev.id}
														href={`/api/scans/${selectedFindingDetails.finding.scanRunId}/artifacts/${ev.artifactId}/download`}
														target="_blank"
														rel="noreferrer"
														style={{
															display: "inline-flex",
															alignItems: "center",
															gap: "6px",
															fontSize: "12px",
															padding: "6px 10px",
															background: "#f1f5f9",
															border: "1px solid #cbd5e1",
															borderRadius: "4px",
															color: "#2563eb",
															textDecoration: "none",
														}}
													>
														<Download
															style={{ width: "12px", height: "12px" }}
														/>
														<span>
															{ev.title ||
																`Artifact ${ev.artifactId?.slice(0, 8)}`}
														</span>
													</a>
												))}
										</div>
									</div>
								) : null}

								{/* LLM Review Actions and Results */}
								<div className="detail-section">
									<h3 className="detail-section-title">LLM Finding Review</h3>

									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											gap: "12px",
											flexWrap: "wrap",
											marginBottom: "10px",
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: "8px",
											}}
										>
											<Brain
												className="icon text-teal-700"
												style={{ width: "20px", height: "20px" }}
											/>
											<strong style={{ fontSize: "15px", color: "#0f172a" }}>
												Review Status:
											</strong>
											{selectedFindingDetails.latestReview ? (
												<span
													className={`reviewer-header-badge reviewer-badge-${selectedFindingDetails.latestReview.status}`}
												>
													{getStatusIcon(
														selectedFindingDetails.latestReview.status,
													)}
													<span style={{ textTransform: "capitalize" }}>
														{selectedFindingDetails.latestReview.status}
													</span>
												</span>
											) : (
												<span
													style={{
														fontSize: "14px",
														color: "#64748b",
														fontStyle: "italic",
													}}
												>
													No reviews conducted yet
												</span>
											)}
										</div>

										<Button
											type="button"
											variant="primary"
											onClick={() => void handleTriggerReview()}
											disabled={
												busy ||
												reviewLoading ||
												selectedFindingDetails.latestReview?.status ===
													"running"
											}
											style={{
												display: "inline-flex",
												alignItems: "center",
												gap: "6px",
											}}
										>
											{reviewLoading ||
											selectedFindingDetails.latestReview?.status ===
												"running" ? (
												<RefreshCw className="icon animate-spin" />
											) : (
												<Sparkles className="icon" />
											)}
											<span>Run LLM Review</span>
										</Button>
									</div>

									{selectedFindingDetails.latestReview ? (
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												gap: "16px",
											}}
										>
											{/* Review Info Bar */}
											<div className="review-header-panel">
												<div className="review-meta">
													<div className="review-meta-item">
														<strong>LLM Service:</strong>{" "}
														{selectedFindingDetails.latestReview.provider} /{" "}
														{selectedFindingDetails.latestReview.model}
													</div>
													<div className="review-meta-item">
														<strong>Started:</strong>{" "}
														{formatDateTime(
															selectedFindingDetails.latestReview.startedAt,
														)}
													</div>
													{selectedFindingDetails.latestReview.completedAt ? (
														<div className="review-meta-item">
															<strong>Completed:</strong>{" "}
															{formatDateTime(
																selectedFindingDetails.latestReview.completedAt,
															)}
														</div>
													) : null}
												</div>
											</div>

											{selectedFindingDetails.latestReview.status ===
												"failed" &&
											selectedFindingDetails.latestReview.errorMessage ? (
												<div
													style={{
														background: "#fef2f2",
														border: "1px solid #fee2e2",
														borderRadius: "8px",
														padding: "12px 16px",
														color: "#b91c1c",
														fontSize: "13px",
													}}
												>
													<strong
														style={{ display: "block", marginBottom: "4px" }}
													>
														Review Failed Error:
													</strong>
													{selectedFindingDetails.latestReview.errorMessage}
												</div>
											) : null}

											{selectedFindingDetails.latestReview.status ===
											"completed" ? (
												<>
													{/* Assessment Cards Grid */}
													<div className="assessment-grid">
														{/* False Positive Assessment */}
														{selectedFindingDetails.latestReview
															.falsePositiveAssessment ? (
															<div className="assessment-card">
																<div className="assessment-card-header">
																	<span className="assessment-card-title">
																		False Positive
																	</span>
																	<span
																		className={`assessment-card-value val-fp-${selectedFindingDetails.latestReview.falsePositiveAssessment.level}`}
																	>
																		{
																			selectedFindingDetails.latestReview
																				.falsePositiveAssessment.level
																		}
																	</span>
																</div>
																<p className="assessment-card-reasoning">
																	{
																		selectedFindingDetails.latestReview
																			.falsePositiveAssessment.reasoning
																	}
																</p>
															</div>
														) : null}

														{/* Evidence Strength */}
														{selectedFindingDetails.latestReview
															.evidenceStrength ? (
															<div className="assessment-card">
																<div className="assessment-card-header">
																	<span className="assessment-card-title">
																		Evidence Strength
																	</span>
																	<span
																		className={`assessment-card-value val-strength-${selectedFindingDetails.latestReview.evidenceStrength.level}`}
																	>
																		{
																			selectedFindingDetails.latestReview
																				.evidenceStrength.level
																		}
																	</span>
																</div>
																<p className="assessment-card-reasoning">
																	{
																		selectedFindingDetails.latestReview
																			.evidenceStrength.reasoning
																	}
																</p>
															</div>
														) : null}

														{/* Confidence Adjustment */}
														{selectedFindingDetails.latestReview
															.confidenceAdjustment ? (
															<div className="assessment-card">
																<div className="assessment-card-header">
																	<span className="assessment-card-title">
																		Confidence Adj.
																	</span>
																	<span
																		className={`assessment-card-value val-adj-${selectedFindingDetails.latestReview.confidenceAdjustment}`}
																	>
																		{
																			selectedFindingDetails.latestReview
																				.confidenceAdjustment
																		}
																	</span>
																</div>
																<p className="assessment-card-reasoning">
																	The reviewer suggested a{" "}
																	<strong>
																		{
																			selectedFindingDetails.latestReview
																				.confidenceAdjustment
																		}
																	</strong>{" "}
																	to the tool's finding confidence rating based
																	on the evidence structure.
																</p>
															</div>
														) : null}
													</div>

													{/* Likely Impact */}
													{selectedFindingDetails.latestReview.likelyImpact ? (
														<div className="detail-section">
															<div
																style={{
																	display: "flex",
																	alignItems: "center",
																	gap: "6px",
																	fontWeight: "700",
																	fontSize: "13px",
																	color: "#475569",
																}}
															>
																<AlertTriangle className="icon" />
																<span>LIKELY IMPACT & SEVERITY ASSESSMENT</span>
															</div>
															<div
																style={{
																	background: "#fff",
																	border: "1px solid #e2e8f0",
																	borderRadius: "8px",
																	padding: "12px 16px",
																	fontSize: "13px",
																	color: "#334155",
																	lineHeight: "1.5",
																}}
															>
																{
																	selectedFindingDetails.latestReview
																		.likelyImpact
																}
															</div>
														</div>
													) : null}

													{/* Remediation Direction */}
													{selectedFindingDetails.latestReview
														.remediationDirection ? (
														<div className="detail-section">
															<div
																style={{
																	display: "flex",
																	alignItems: "center",
																	gap: "6px",
																	fontWeight: "700",
																	fontSize: "13px",
																	color: "#475569",
																}}
															>
																<Code className="icon" />
																<span>REMEDIATION DIRECTION</span>
															</div>
															<pre className="remediation-box">
																<code>
																	{
																		selectedFindingDetails.latestReview
																			.remediationDirection
																	}
																</code>
															</pre>
														</div>
													) : null}

													{/* Reviewer Notes */}
													{selectedFindingDetails.latestReview.reviewerNotes &&
													selectedFindingDetails.latestReview.reviewerNotes
														.length > 0 ? (
														<div className="detail-section">
															<div
																style={{
																	display: "flex",
																	alignItems: "center",
																	gap: "6px",
																	fontWeight: "700",
																	fontSize: "13px",
																	color: "#475569",
																}}
															>
																<Info className="icon" />
																<span>ADDITIONAL REVIEWER NOTES</span>
															</div>
															<ul className="notes-list">
																{selectedFindingDetails.latestReview.reviewerNotes.map(
																	(note, idx) => (
																		// biome-ignore lint/suspicious/noArrayIndexKey: index is safe here
																		<li key={idx}>{note}</li>
																	),
																)}
															</ul>
														</div>
													) : null}
												</>
											) : null}

											{/* Historical Reviews List */}
											{allReviews.length > 1 ? (
												<div
													className="detail-section"
													style={{ marginTop: "10px" }}
												>
													<h4
														style={{
															fontSize: "12px",
															fontWeight: "700",
															color: "#64748b",
															textTransform: "uppercase",
															letterSpacing: "0.05em",
														}}
													>
														Prior Reviews History ({allReviews.length})
													</h4>
													<div
														style={{
															display: "flex",
															flexDirection: "column",
															gap: "6px",
															maxHeight: "150px",
															overflowY: "auto",
															border: "1px solid #e2e8f0",
															borderRadius: "8px",
															padding: "8px",
															background: "#f8fafc",
														}}
													>
														{allReviews.map((rev) => (
															<div
																key={rev.id}
																style={{
																	display: "flex",
																	justifyContent: "space-between",
																	alignItems: "center",
																	fontSize: "12px",
																	padding: "6px",
																	borderRadius: "4px",
																	border:
																		rev.id ===
																		selectedFindingDetails.latestReview?.id
																			? "1px solid #cbd5e1"
																			: "1px solid transparent",
																	background:
																		rev.id ===
																		selectedFindingDetails.latestReview?.id
																			? "#fff"
																			: "transparent",
																}}
															>
																<span style={{ color: "#334155" }}>
																	{rev.provider} ({rev.model}) -{" "}
																	{formatDateTime(
																		rev.completedAt || rev.createdAt,
																	)}
																</span>
																<span
																	className={`scan-status-badge badge-${rev.status}`}
																	style={{
																		fontSize: "10px",
																		padding: "1px 5px",
																	}}
																>
																	{rev.status}
																</span>
															</div>
														))}
													</div>
												</div>
											) : null}
										</div>
									) : null}
								</div>

								{/* Sandbox Reproduction Section */}
								<div
									className="detail-section"
									style={{ borderTop: "1px solid #e2e8f0", paddingTop: "20px" }}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											gap: "12px",
											flexWrap: "wrap",
											marginBottom: "10px",
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: "8px",
											}}
										>
											<Shield
												className="icon text-teal-700"
												style={{ width: "20px", height: "20px" }}
											/>
											<h3
												style={{
													fontSize: "16px",
													fontWeight: "700",
													color: "#0f172a",
													margin: 0,
												}}
											>
												Sandbox Reproduction
											</h3>
										</div>
									</div>

									<p
										style={{
											fontSize: "14px",
											color: "#475569",
											marginBottom: "16px",
										}}
									>
										Run verification checks in an isolated Docker container to
										confirm if this finding is still active in the current
										codebase state.
									</p>

									{reproError && (
										<div
											style={{
												background: "#fef2f2",
												border: "1px solid #fee2e2",
												borderRadius: "8px",
												padding: "12px 16px",
												color: "#b91c1c",
												fontSize: "13px",
												marginBottom: "16px",
											}}
										>
											{reproError}
										</div>
									)}

									{/* Profile Trigger Form */}
									{reproProfiles.length > 0 ? (
										<div
											style={{
												display: "flex",
												gap: "12px",
												alignItems: "flex-end",
												flexWrap: "wrap",
												marginBottom: "20px",
												background: "#f8fafc",
												border: "1px solid #e2e8f0",
												borderRadius: "8px",
												padding: "16px",
											}}
										>
											<div style={{ flex: "1 1 250px" }}>
												<label
													htmlFor="repro-profile-select"
													style={{
														display: "block",
														fontSize: "12px",
														fontWeight: "600",
														color: "#475569",
														marginBottom: "6px",
													}}
												>
													Select Bounded Verification Profile
												</label>
												<select
													id="repro-profile-select"
													value={selectedReproProfile}
													onChange={(e) =>
														setSelectedReproProfile(e.target.value)
													}
													style={{
														width: "100%",
														padding: "8px 12px",
														borderRadius: "6px",
														border: "1px solid #cbd5e1",
														background: "#fff",
														fontSize: "14px",
														color: "#0f172a",
													}}
												>
													{reproProfiles.map((p) => (
														<option
															key={p.id}
															value={p.id}
															disabled={!p.isApplicable}
														>
															{p.displayName}{" "}
															{!p.isApplicable ? "(Not Applicable)" : ""}
														</option>
													))}
												</select>
											</div>

											<Button
												type="button"
												variant="primary"
												onClick={() => void handleTriggerReproduction()}
												disabled={reproLoading || busy || !selectedReproProfile}
												style={{
													display: "inline-flex",
													alignItems: "center",
													gap: "6px",
													height: "38px",
												}}
											>
												{reproLoading ? (
													<RefreshCw className="icon animate-spin" />
												) : (
													<Shield className="icon" />
												)}
												<span>Trigger Sandbox Run</span>
											</Button>

											{/* Applicability Description */}
											{(() => {
												const selected = reproProfiles.find(
													(p) => p.id === selectedReproProfile,
												);
												if (!selected) return null;
												return (
													<div
														style={{
															width: "100%",
															marginTop: "8px",
															fontSize: "13px",
															color: "#64748b",
														}}
													>
														<strong>Description:</strong> {selected.description}
														{selected.applicabilityReason && (
															<div
																style={{
																	marginTop: "4px",
																	color: selected.isApplicable
																		? "#059669"
																		: "#dc2626",
																}}
															>
																<strong>Status:</strong>{" "}
																{selected.applicabilityReason}
															</div>
														)}
													</div>
												);
											})()}
										</div>
									) : (
										<div
											style={{
												fontSize: "14px",
												color: "#64748b",
												fontStyle: "italic",
												marginBottom: "20px",
											}}
										>
											No reproduction profiles available.
										</div>
									)}

									{/* Reproduction History List */}
									{reproRuns.length > 0 ? (
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												gap: "12px",
											}}
										>
											<h4
												style={{
													fontSize: "13px",
													fontWeight: "700",
													color: "#475569",
													margin: 0,
												}}
											>
												Sandbox Run History ({reproRuns.length})
											</h4>
											<div
												style={{
													display: "flex",
													flexDirection: "column",
													gap: "8px",
												}}
											>
												{reproRuns.map((run) => {
													const isExpanded = expandedReproRunId === run.id;
													const runArt = reproRunArtifacts[run.id] || [];
													const runEv = reproRunEvidence[run.id] || [];
													return (
														<div
															key={run.id}
															style={{
																border: "1px solid #e2e8f0",
																borderRadius: "8px",
																overflow: "hidden",
																background: "#fff",
															}}
														>
															{/* Run Header */}
															<button
																type="button"
																onClick={() =>
																	void handleToggleReproRun(run.id)
																}
																style={{
																	display: "flex",
																	width: "100%",
																	justifyContent: "space-between",
																	alignItems: "center",
																	padding: "12px 16px",
																	border: 0,
																	background: "#f8fafc",
																	cursor: "pointer",
																	font: "inherit",
																	textAlign: "left",
																	userSelect: "none",
																}}
															>
																<div
																	style={{
																		display: "flex",
																		alignItems: "center",
																		gap: "12px",
																		flexWrap: "wrap",
																	}}
																>
																	<span
																		style={{
																			fontSize: "14px",
																			fontWeight: "600",
																			color: "#0f172a",
																		}}
																	>
																		{reproProfiles.find(
																			(p) => p.id === run.profileId,
																		)?.displayName || run.profileId}
																	</span>
																	<span
																		style={{
																			fontSize: "12px",
																			color: "#64748b",
																		}}
																	>
																		{formatDateTime(run.createdAt)}
																	</span>
																</div>

																<div
																	style={{
																		display: "flex",
																		alignItems: "center",
																		gap: "8px",
																	}}
																>
																	<span
																		className={`scan-status-badge badge-${run.status}`}
																		style={{ textTransform: "capitalize" }}
																	>
																		{run.status}
																	</span>
																	{run.outcome && (
																		<span
																			className={`scan-status-badge badge-${run.outcome}`}
																		>
																			{run.outcome === "reproduced"
																				? "Reproduced"
																				: run.outcome === "not_reproduced"
																					? "Not Reproduced"
																					: run.outcome === "inconclusive"
																						? "Inconclusive"
																						: run.outcome === "error"
																							? "Error"
																							: run.outcome}
																		</span>
																	)}
																</div>
															</button>

															{/* Run Details */}
															{isExpanded && (
																<div
																	style={{
																		padding: "16px",
																		borderTop: "1px solid #e2e8f0",
																		background: "#fff",
																		display: "flex",
																		flexDirection: "column",
																		gap: "16px",
																	}}
																>
																	{/* Metadata info */}
																	<div
																		style={{
																			display: "grid",
																			gridTemplateColumns:
																				"repeat(auto-fit, minmax(200px, 1fr))",
																			gap: "12px",
																			fontSize: "13px",
																			color: "#334155",
																		}}
																	>
																		<div>
																			<strong>Runner:</strong> {run.runner}
																		</div>
																		{run.exitCode !== null && (
																			<div>
																				<strong>Exit Code:</strong>{" "}
																				{run.exitCode}
																			</div>
																		)}
																		{run.completedAt && (
																			<div>
																				<strong>Duration:</strong> {(() => {
																					const start = new Date(
																						run.startedAt || run.createdAt,
																					).getTime();
																					const end = new Date(
																						run.completedAt,
																					).getTime();
																					return `${((end - start) / 1000).toFixed(1)}s`;
																				})()}
																			</div>
																		)}
																	</div>

																	{/* Command JSON */}
																	{run.commandJson && (
																		<div>
																			<strong
																				style={{
																					display: "block",
																					fontSize: "12px",
																					color: "#475569",
																					marginBottom: "6px",
																				}}
																			>
																				Executed Bounded Command:
																			</strong>
																			<pre
																				style={{
																					margin: 0,
																					padding: "10px",
																					background: "#0f172a",
																					color: "#38bdf8",
																					borderRadius: "6px",
																					fontSize: "12px",
																					overflowX: "auto",
																				}}
																			>
																				<code>{run.commandJson.join(" ")}</code>
																			</pre>
																		</div>
																	)}

																	{run.errorMessage && (
																		<div
																			style={{
																				padding: "10px 12px",
																				background: "#fef2f2",
																				border: "1px solid #fee2e2",
																				borderRadius: "6px",
																				color: "#b91c1c",
																				fontSize: "13px",
																			}}
																		>
																			<strong>Error:</strong> {run.errorMessage}
																		</div>
																	)}

																	{/* Evidence section */}
																	{runEv.length > 0 && (
																		<div>
																			<strong
																				style={{
																					display: "block",
																					fontSize: "12px",
																					color: "#475569",
																					marginBottom: "6px",
																				}}
																			>
																				Reproduction Observations:
																			</strong>
																			<div
																				style={{
																					display: "flex",
																					flexDirection: "column",
																					gap: "8px",
																				}}
																			>
																				{runEv.map((ev) => (
																					<div
																						key={ev.id}
																						style={{
																							border: "1px solid #cbd5e1",
																							borderRadius: "6px",
																							padding: "12px",
																						}}
																					>
																						<div
																							style={{
																								fontWeight: "600",
																								fontSize: "13px",
																								color: "#0f172a",
																								marginBottom: "4px",
																							}}
																						>
																							{ev.title}
																						</div>
																						{ev.snippet && (
																							<pre
																								style={{
																									margin: 0,
																									padding: "8px",
																									background: "#f1f5f9",
																									borderRadius: "4px",
																									fontSize: "12px",
																									overflowX: "auto",
																									color: "#334155",
																								}}
																							>
																								<code>{ev.snippet}</code>
																							</pre>
																						)}
																					</div>
																				))}
																			</div>
																		</div>
																	)}

																	{/* Artifacts links */}
																	{runArt.length > 0 && (
																		<div>
																			<strong
																				style={{
																					display: "block",
																					fontSize: "12px",
																					color: "#475569",
																					marginBottom: "6px",
																				}}
																			>
																				Run Artifacts:
																			</strong>
																			<div
																				style={{
																					display: "flex",
																					gap: "8px",
																					flexWrap: "wrap",
																				}}
																			>
																				{runArt.map((art) => (
																					<a
																						key={art.id}
																						href={`/api/reproduction-runs/${run.id}/artifacts/${art.id}`}
																						target="_blank"
																						rel="noreferrer"
																						style={{
																							display: "inline-flex",
																							alignItems: "center",
																							gap: "6px",
																							fontSize: "12px",
																							padding: "6px 10px",
																							background: "#f1f5f9",
																							border: "1px solid #cbd5e1",
																							borderRadius: "4px",
																							color: "#2563eb",
																							textDecoration: "none",
																						}}
																					>
																						<Download
																							style={{
																								width: "12px",
																								height: "12px",
																							}}
																						/>
																						<span>
																							{art.kind} ({art.format})
																						</span>
																					</a>
																				))}
																			</div>
																		</div>
																	)}
																</div>
															)}
														</div>
													);
												})}
											</div>
										</div>
									) : (
										<div
											style={{
												fontSize: "14px",
												color: "#64748b",
												fontStyle: "italic",
											}}
										>
											No reproduction runs recorded for this finding.
										</div>
									)}
								</div>

								{/* Dynamic Verification Section */}
								<div
									className="detail-section"
									style={{
										borderTop: "1px solid #e2e8f0",
										paddingTop: "20px",
										marginTop: "20px",
									}}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											gap: "12px",
											flexWrap: "wrap",
											marginBottom: "10px",
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: "8px",
											}}
										>
											<Shield
												className="icon text-teal-700"
												style={{ width: "20px", height: "20px" }}
											/>
											<h3
												style={{
													fontSize: "16px",
													fontWeight: "700",
													color: "#0f172a",
													margin: 0,
												}}
											>
												Dynamic Sandbox Verification
											</h3>
										</div>
									</div>

									<p
										style={{
											fontSize: "14px",
											color: "#475569",
											marginBottom: "16px",
										}}
									>
										Run project-defined verification checks (tests, sanitizers,
										or fuzzers) in a secure, bounded Docker sandbox. Note:
										Bounded dynamic runs are observation-only; passing tests or
										fuzzer runs do not guarantee code is secure or fix is
										complete.
									</p>

									{dynamicError && (
										<div
											style={{
												background: "#fef2f2",
												border: "1px solid #fee2e2",
												borderRadius: "8px",
												padding: "12px 16px",
												color: "#b91c1c",
												fontSize: "13px",
												marginBottom: "16px",
											}}
										>
											{dynamicError}
										</div>
									)}

									{/* Profile Trigger Form */}
									{dynamicProfiles.length > 0 ? (
										<div
											style={{
												display: "flex",
												gap: "12px",
												alignItems: "flex-end",
												flexWrap: "wrap",
												marginBottom: "20px",
												background: "#f8fafc",
												border: "1px solid #e2e8f0",
												borderRadius: "8px",
												padding: "16px",
											}}
										>
											<div style={{ flex: "1 1 250px" }}>
												<label
													htmlFor="dynamic-profile-select"
													style={{
														display: "block",
														fontSize: "12px",
														fontWeight: "600",
														color: "#475569",
														marginBottom: "6px",
													}}
												>
													Select Dynamic Verification Profile
												</label>
												<select
													id="dynamic-profile-select"
													value={selectedDynamicProfile}
													onChange={(e) => {
														setSelectedDynamicProfile(e.target.value);
														setAllowProjectScriptsConsent(false);
													}}
													style={{
														width: "100%",
														padding: "8px 12px",
														borderRadius: "6px",
														border: "1px solid #cbd5e1",
														background: "#fff",
														fontSize: "14px",
														color: "#0f172a",
													}}
												>
													{dynamicProfiles.map((p) => (
														<option
															key={p.id}
															value={p.profileId}
															disabled={!p.enabled}
														>
															{p.displayName} ({p.dynamicKind.toUpperCase()}){" "}
															{!p.enabled ? "(Disabled)" : ""}
														</option>
													))}
												</select>
											</div>

											<Button
												type="button"
												variant="primary"
												onClick={() => void handleTriggerDynamic()}
												disabled={
													dynamicLoading ||
													busy ||
													!selectedDynamicProfile ||
													(() => {
														const selected = dynamicProfiles.find(
															(p) => p.profileId === selectedDynamicProfile,
														);
														return !!(
															selected?.allowProjectScripts &&
															!allowProjectScriptsConsent
														);
													})()
												}
												style={{
													display: "inline-flex",
													alignItems: "center",
													gap: "6px",
													height: "38px",
												}}
											>
												{dynamicLoading ? (
													<RefreshCw className="icon animate-spin" />
												) : (
													<Shield className="icon" />
												)}
												<span>Trigger Sandbox Run</span>
											</Button>

											{/* Profile Preview Command */}
											{(() => {
												const selected = dynamicProfiles.find(
													(p) => p.profileId === selectedDynamicProfile,
												);
												if (!selected) return null;
												return (
													<div
														style={{
															width: "100%",
															marginTop: "8px",
															fontSize: "13px",
															color: "#64748b",
														}}
													>
														<div>
															<strong>Command Preview:</strong>{" "}
															<code
																style={{
																	background: "#e2e8f0",
																	padding: "2px 4px",
																	borderRadius: "4px",
																}}
															>
																{selected.commandJson.join(" ")}
															</code>
														</div>
														{selected.allowProjectScripts && (
															<div
																style={{
																	marginTop: "12px",
																	background: "#fffbeb",
																	border: "1px solid #fef3c7",
																	borderRadius: "8px",
																	padding: "12px",
																	fontSize: "13px",
																	color: "#b45309",
																	width: "100%",
																}}
															>
																<div
																	style={{
																		fontWeight: "700",
																		marginBottom: "4px",
																	}}
																>
																	⚠️ Project Script Execution Consent Required
																</div>
																This profile runs project-defined commands (such
																as npm test or custom test scripts) inside the
																sandbox.
																<label
																	style={{
																		display: "flex",
																		alignItems: "center",
																		gap: "8px",
																		marginTop: "8px",
																		cursor: "pointer",
																		fontWeight: "600",
																	}}
																>
																	<input
																		type="checkbox"
																		checked={allowProjectScriptsConsent}
																		onChange={(e) =>
																			setAllowProjectScriptsConsent(
																				e.target.checked,
																			)
																		}
																	/>
																	I understand and consent to executing project
																	scripts in the Docker sandbox
																</label>
															</div>
														)}
													</div>
												);
											})()}
										</div>
									) : (
										<div
											style={{
												fontSize: "14px",
												color: "#64748b",
												fontStyle: "italic",
												marginBottom: "20px",
											}}
										>
											No dynamic verification profiles configured.
										</div>
									)}

									{/* Dynamic Run History List */}
									{dynamicRuns.length > 0 ? (
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												gap: "12px",
											}}
										>
											<h4
												style={{
													fontSize: "13px",
													fontWeight: "700",
													color: "#475569",
													margin: 0,
												}}
											>
												Dynamic Sandbox Run History ({dynamicRuns.length})
											</h4>
											<div
												style={{
													display: "flex",
													flexDirection: "column",
													gap: "8px",
												}}
											>
												{dynamicRuns.map((run) => {
													const isExpanded = expandedDynamicRunId === run.id;
													const runArt = dynamicRunArtifacts[run.id] || [];
													const runEv = dynamicRunEvidence[run.id] || [];
													return (
														<div
															key={run.id}
															style={{
																border: "1px solid #e2e8f0",
																borderRadius: "8px",
																overflow: "hidden",
																background: "#fff",
															}}
														>
															{/* Run Header */}
															<button
																type="button"
																onClick={() =>
																	void handleToggleDynamicRun(run.id)
																}
																style={{
																	display: "flex",
																	width: "100%",
																	justifyContent: "space-between",
																	alignItems: "center",
																	padding: "12px 16px",
																	border: 0,
																	background: "#f8fafc",
																	cursor: "pointer",
																	font: "inherit",
																	textAlign: "left",
																	userSelect: "none",
																}}
															>
																<div
																	style={{
																		display: "flex",
																		alignItems: "center",
																		gap: "12px",
																		flexWrap: "wrap",
																	}}
																>
																	<span
																		style={{
																			fontSize: "14px",
																			fontWeight: "600",
																			color: "#0f172a",
																		}}
																	>
																		{dynamicProfiles.find(
																			(p) => p.profileId === run.profileId,
																		)?.displayName || run.profileId}
																	</span>
																	<span
																		style={{
																			fontSize: "12px",
																			color: "#64748b",
																		}}
																	>
																		{formatDateTime(run.createdAt)}
																	</span>
																</div>

																<div
																	style={{
																		display: "flex",
																		alignItems: "center",
																		gap: "8px",
																	}}
																>
																	<span
																		className={`scan-status-badge badge-${run.status}`}
																		style={{ textTransform: "capitalize" }}
																	>
																		{run.status}
																	</span>
																	{run.outcome && (
																		<span
																			className={`scan-status-badge badge-${run.outcome}`}
																		>
																			{run.outcome === "passed"
																				? "Passed (Observed No Crash)"
																				: run.outcome === "failed"
																					? "Failed (Non-zero Exit Code)"
																					: run.outcome === "crashed"
																						? "Crashed (Observed Crash)"
																						: run.outcome === "timed_out"
																							? "Timed Out"
																							: run.outcome === "inconclusive"
																								? "Inconclusive"
																								: run.outcome === "error"
																									? "Runner Error"
																									: run.outcome}
																		</span>
																	)}
																</div>
															</button>

															{/* Run Details */}
															{isExpanded && (
																<div
																	style={{
																		padding: "16px",
																		borderTop: "1px solid #e2e8f0",
																		background: "#fff",
																		display: "flex",
																		flexDirection: "column",
																		gap: "16px",
																	}}
																>
																	{/* Metadata info */}
																	<div
																		style={{
																			display: "grid",
																			gridTemplateColumns:
																				"repeat(auto-fit, minmax(200px, 1fr))",
																			gap: "12px",
																			fontSize: "13px",
																			color: "#334155",
																		}}
																	>
																		<div>
																			<strong>Runner:</strong> {run.runner}
																		</div>
																		{run.exitCode !== null && (
																			<div>
																				<strong>Exit Code:</strong>{" "}
																				{run.exitCode}
																			</div>
																		)}
																		{run.completedAt && (
																			<div>
																				<strong>Duration:</strong> {(() => {
																					const start = new Date(
																						run.startedAt || run.createdAt,
																					).getTime();
																					const end = new Date(
																						run.completedAt,
																					).getTime();
																					return `${((end - start) / 1000).toFixed(1)}s`;
																				})()}
																			</div>
																		)}
																	</div>

																	{/* Command JSON */}
																	{run.commandJson && (
																		<div>
																			<strong
																				style={{
																					display: "block",
																					fontSize: "12px",
																					color: "#475569",
																					marginBottom: "6px",
																				}}
																			>
																				Executed Bounded Command:
																			</strong>
																			<pre
																				style={{
																					margin: 0,
																					padding: "10px",
																					background: "#0f172a",
																					color: "#38bdf8",
																					borderRadius: "6px",
																					fontSize: "12px",
																					overflowX: "auto",
																				}}
																			>
																				<code>{run.commandJson.join(" ")}</code>
																			</pre>
																		</div>
																	)}

																	{run.errorMessage && (
																		<div
																			style={{
																				padding: "10px 12px",
																				background: "#fef2f2",
																				border: "1px solid #fee2e2",
																				borderRadius: "6px",
																				color: "#b91c1c",
																				fontSize: "13px",
																			}}
																		>
																			<strong>Error:</strong> {run.errorMessage}
																		</div>
																	)}

																	{/* Evidence section */}
																	{runEv.length > 0 && (
																		<div>
																			<strong
																				style={{
																					display: "block",
																					fontSize: "12px",
																					color: "#475569",
																					marginBottom: "6px",
																				}}
																			>
																				Verification Observations:
																			</strong>
																			<div
																				style={{
																					display: "flex",
																					flexDirection: "column",
																					gap: "8px",
																				}}
																			>
																				{runEv.map((ev) => (
																					<div
																						key={ev.id}
																						style={{
																							border: "1px solid #cbd5e1",
																							borderRadius: "6px",
																							padding: "12px",
																						}}
																					>
																						<div
																							style={{
																								fontWeight: "600",
																								fontSize: "13px",
																								color: "#0f172a",
																								marginBottom: "4px",
																							}}
																						>
																							{ev.title}
																						</div>
																						{ev.snippet && (
																							<pre
																								style={{
																									margin: 0,
																									padding: "8px",
																									background: "#f1f5f9",
																									borderRadius: "4px",
																									fontSize: "12px",
																									overflowX: "auto",
																									color: "#334155",
																								}}
																							>
																								<code>{ev.snippet}</code>
																							</pre>
																						)}
																					</div>
																				))}
																			</div>
																		</div>
																	)}

																	{/* Artifacts links */}
																	{runArt.length > 0 && (
																		<div>
																			<strong
																				style={{
																					display: "block",
																					fontSize: "12px",
																					color: "#475569",
																					marginBottom: "6px",
																				}}
																			>
																				Run Artifacts:
																			</strong>
																			<div
																				style={{
																					display: "flex",
																					gap: "8px",
																					flexWrap: "wrap",
																				}}
																			>
																				{runArt.map((art) => (
																					<a
																						key={art.id}
																						href={`/api/dynamic-runs/${run.id}/artifacts/${art.id}`}
																						target="_blank"
																						rel="noreferrer"
																						style={{
																							display: "inline-flex",
																							alignItems: "center",
																							gap: "6px",
																							fontSize: "12px",
																							padding: "6px 10px",
																							background: "#f1f5f9",
																							border: "1px solid #cbd5e1",
																							borderRadius: "4px",
																							color: "#2563eb",
																							textDecoration: "none",
																						}}
																					>
																						<Download
																							style={{
																								width: "12px",
																								height: "12px",
																							}}
																						/>
																						<span>
																							{art.kind} ({art.format})
																						</span>
																					</a>
																				))}
																			</div>
																		</div>
																	)}
																</div>
															)}
														</div>
													);
												})}
											</div>
										</div>
									) : (
										<div
											style={{
												fontSize: "14px",
												color: "#64748b",
												fontStyle: "italic",
											}}
										>
											No dynamic verification runs recorded for this finding.
										</div>
									)}
								</div>

								{/* Reviewer Decision Section */}
								<div
									className="detail-section"
									style={{ borderTop: "1px solid #e2e8f0", paddingTop: "20px" }}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "8px",
											marginBottom: "10px",
										}}
									>
										<Shield
											className="icon text-teal-700"
											style={{ width: "20px", height: "20px" }}
										/>
										<h3
											style={{
												fontSize: "16px",
												fontWeight: "700",
												color: "#0f172a",
												margin: 0,
											}}
										>
											Reviewer Decision
										</h3>
									</div>

									<div className="decision-panel">
										<form
											onSubmit={handleDecisionSubmit}
											style={{
												display: "flex",
												flexDirection: "column",
												gap: "16px",
											}}
										>
											<div className="decision-form-row">
												<div className="decision-form-field">
													<label htmlFor="decision-select">
														Decision State
													</label>
													<select
														id="decision-select"
														value={decisionInput}
														onChange={(e) =>
															setDecisionInput(
																e.target.value as
																	| "accepted"
																	| "false_positive"
																	| "deferred"
																	| "needs_fix",
															)
														}
														required
													>
														<option value="accepted">Accepted</option>
														<option value="false_positive">
															False Positive
														</option>
														<option value="deferred">Deferred</option>
														<option value="needs_fix">Needs Fix</option>
													</select>
												</div>

												<div className="decision-form-field">
													<label htmlFor="reason-select">Reason</label>
													<select
														id="reason-select"
														value={reasonInput}
														onChange={(e) => setReasonInput(e.target.value)}
														required
													>
														<option value="confirmed_by_evidence">
															Confirmed by Evidence
														</option>
														<option value="confirmed_by_review">
															Confirmed by Review
														</option>
														<option value="insufficient_evidence">
															Insufficient Evidence
														</option>
														<option value="environment_specific">
															Environment Specific
														</option>
														<option value="tool_noise">Tool Noise</option>
														<option value="not_exploitable">
															Not Exploitable
														</option>
														<option value="accepted_risk">Accepted Risk</option>
														<option value="other">Other</option>
													</select>
												</div>
											</div>

											<div className="decision-form-field">
												<label htmlFor="comment-textarea">
													Comment / Rationale
												</label>
												<textarea
													id="comment-textarea"
													rows={3}
													value={commentInput}
													onChange={(e) => setCommentInput(e.target.value)}
													placeholder="Explain the reason for this decision..."
												/>
											</div>

											{selectedFindingDetails.latestReview && (
												<div
													style={{
														display: "flex",
														alignItems: "center",
														gap: "8px",
													}}
												>
													<input
														id="link-review-checkbox"
														type="checkbox"
														checked={linkReviewInput}
														onChange={(e) =>
															setLinkReviewInput(e.target.checked)
														}
														style={{ cursor: "pointer" }}
													/>
													<label
														htmlFor="link-review-checkbox"
														style={{
															fontSize: "13px",
															color: "#475569",
															cursor: "pointer",
														}}
													>
														Link to latest LLM Review (
														{selectedFindingDetails.latestReview.model})
													</label>
												</div>
											)}

											<div
												style={{ display: "flex", justifyContent: "flex-end" }}
											>
												<Button
													type="submit"
													variant="primary"
													disabled={busy || decisionSubmitLoading}
												>
													{decisionSubmitLoading
														? "Submitting..."
														: "Record Decision"}
												</Button>
											</div>
										</form>
									</div>
								</div>

								{/* Historical Decisions Timeline */}
								{allDecisions.length > 0 && (
									<div
										className="detail-section"
										style={{
											borderTop: "1px solid #e2e8f0",
											paddingTop: "20px",
										}}
									>
										<h4
											style={{
												fontSize: "12px",
												fontWeight: "700",
												color: "#64748b",
												textTransform: "uppercase",
												letterSpacing: "0.05em",
												marginBottom: "12px",
											}}
										>
											Decision History & Timeline
										</h4>
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												gap: "4px",
											}}
										>
											{allDecisions.map((dec, idx) => (
												<div
													key={dec.id}
													className={`timeline-item ${idx === 0 ? "active-node" : ""}`}
												>
													<div
														style={{
															flex: 1,
															display: "flex",
															flexDirection: "column",
															gap: "4px",
														}}
													>
														<div
															style={{
																display: "flex",
																alignItems: "center",
																gap: "8px",
																flexWrap: "wrap",
															}}
														>
															<span
																className={`decision-badge badge-${dec.decision}`}
															>
																{dec.decision.replace("_", " ")}
															</span>
															<span
																style={{
																	fontSize: "12px",
																	fontWeight: "600",
																	color: "#475569",
																}}
															>
																Reason: {dec.reason.replace(/_/g, " ")}
															</span>
															<span
																style={{
																	fontSize: "11px",
																	color: "#94a3b8",
																	marginLeft: "auto",
																}}
															>
																{formatDateTime(dec.createdAt)}
															</span>
														</div>
														{dec.comment && (
															<p
																style={{
																	margin: "4px 0 0 0",
																	fontSize: "13px",
																	color: "#334155",
																	fontStyle: "italic",
																}}
															>
																"{dec.comment}"
															</p>
														)}
														{dec.linkedReviewId && (
															<span
																style={{
																	fontSize: "11px",
																	color: "#64748b",
																	display: "inline-flex",
																	alignItems: "center",
																	gap: "4px",
																	marginTop: "2px",
																}}
															>
																<Brain
																	style={{ width: "12px", height: "12px" }}
																/>
																Linked to LLM Review
															</span>
														)}
													</div>
												</div>
											))}
										</div>
									</div>
								)}
							</div>
						) : scanSummary ? (
							<div className="scans-detail-scroll" style={{ padding: "20px" }}>
								<div
									className="detail-section"
									style={{
										borderBottom: "1px solid #e2e8f0",
										paddingBottom: "20px",
									}}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: "10px",
											flexWrap: "wrap",
											marginBottom: "8px",
										}}
									>
										<span
											className={`scan-status-badge badge-${scanSummary.profileOutcome}`}
											style={{ padding: "4px 8px", fontSize: "12px" }}
										>
											Outcome:{" "}
											{scanSummary.profileOutcome
												.replace(/_/g, " ")
												.toUpperCase()}
										</span>
										<strong style={{ fontSize: "14px", color: "#475569" }}>
											Profile: {scanSummary.profileId}
										</strong>
									</div>
									<h2
										style={{
											fontSize: "20px",
											fontWeight: "800",
											color: "#0f172a",
											margin: "10px 0",
										}}
									>
										Scan Profile Summary
									</h2>
									<p style={{ margin: 0, fontSize: "14px", color: "#475569" }}>
										Review the execution status and results of each tool in the
										profile.
									</p>
								</div>

								<div
									className="detail-section"
									style={{
										borderBottom: "1px solid #e2e8f0",
										paddingBottom: "20px",
										marginTop: "20px",
									}}
								>
									<h3
										className="detail-section-title"
										style={{ marginBottom: "15px" }}
									>
										Tool Results
									</h3>
									<div
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "12px",
										}}
									>
										{scanSummary.tools.map((t: any) => (
											<div
												key={t.toolId}
												style={{
													background: "#f8fafc",
													borderRadius: "8px",
													border: "1px solid #e2e8f0",
													padding: "14px",
												}}
											>
												<div
													style={{
														display: "flex",
														alignItems: "center",
														justifyContent: "space-between",
														marginBottom: "10px",
													}}
												>
													<strong
														style={{
															color: "#0f172a",
															fontSize: "14px",
															textTransform: "capitalize",
														}}
													>
														{t.toolId}
													</strong>
													<div
														style={{
															display: "flex",
															gap: "6px",
															alignItems: "center",
														}}
													>
														{t.required && (
															<span
																style={{
																	fontSize: "11px",
																	background: "#fee2e2",
																	color: "#ef4444",
																	padding: "2px 6px",
																	borderRadius: "4px",
																	fontWeight: "600",
																}}
															>
																Required
															</span>
														)}
														<span
															className={`scan-status-badge badge-${t.status}`}
															style={{ fontSize: "11px", padding: "2px 6px" }}
														>
															{t.status}
														</span>
													</div>
												</div>
												{t.status === "completed" && (
													<div
														style={{
															display: "grid",
															gridTemplateColumns: "1fr 1fr 1fr",
															gap: "10px",
															marginTop: "10px",
														}}
													>
														<div
															style={{
																background: "#fff",
																padding: "8px",
																borderRadius: "6px",
																border: "1px solid #f1f5f9",
																textAlign: "center",
															}}
														>
															<div
																style={{ fontSize: "11px", color: "#64748b" }}
															>
																Findings
															</div>
															<strong
																style={{ fontSize: "16px", color: "#0f172a" }}
															>
																{t.findingCount}
															</strong>
														</div>
														<div
															style={{
																background: "#fff",
																padding: "8px",
																borderRadius: "6px",
																border: "1px solid #f1f5f9",
																textAlign: "center",
															}}
														>
															<div
																style={{ fontSize: "11px", color: "#64748b" }}
															>
																Artifacts
															</div>
															<strong
																style={{ fontSize: "16px", color: "#0f172a" }}
															>
																{t.artifactCount}
															</strong>
														</div>
														<div
															style={{
																background: "#fff",
																padding: "8px",
																borderRadius: "6px",
																border: "1px solid #f1f5f9",
																textAlign: "center",
															}}
														>
															<div
																style={{ fontSize: "11px", color: "#64748b" }}
															>
																Exit Code
															</div>
															<strong
																style={{ fontSize: "16px", color: "#0f172a" }}
															>
																{t.exitCode ?? 0}
															</strong>
														</div>
													</div>
												)}
												{t.status === "completed" && t.findingCount > 0 && (
													<div
														style={{
															display: "flex",
															gap: "8px",
															flexWrap: "wrap",
															marginTop: "10px",
															background: "#fff",
															padding: "8px",
															borderRadius: "6px",
															border: "1px solid #f1f5f9",
														}}
													>
														<span
															style={{
																fontSize: "11px",
																color: "#64748b",
																display: "block",
																width: "100%",
																marginBottom: "4px",
															}}
														>
															Severities:
														</span>
														{(
															Object.entries(t.severityCounts || {}) as [
																string,
																number,
															][]
														)
															.filter(([_, count]) => count > 0)
															.map(([sev, count]) => (
																<span
																	key={sev}
																	className={`severity-badge ${getSeverityClass(sev)}`}
																	style={{
																		fontSize: "11px",
																		padding: "2px 6px",
																	}}
																>
																	{sev}: {count}
																</span>
															))}
													</div>
												)}
												{t.error && (
													<div
														style={{
															marginTop: "10px",
															padding: "8px 12px",
															background: "#fef2f2",
															color: "#991b1b",
															fontSize: "12px",
															borderRadius: "6px",
															border: "1px solid #fca5a5",
														}}
													>
														<strong>Error:</strong> {t.error}
													</div>
												)}
											</div>
										))}
									</div>
								</div>

								<div className="detail-section" style={{ marginTop: "20px" }}>
									<h3
										className="detail-section-title"
										style={{ marginBottom: "15px" }}
									>
										Scan Totals
									</h3>
									<div
										style={{
											display: "grid",
											gridTemplateColumns: "1fr 1fr",
											gap: "12px",
										}}
									>
										<div
											style={{
												background: "#f8fafc",
												border: "1px solid #e2e8f0",
												padding: "14px",
												borderRadius: "8px",
											}}
										>
											<div style={{ fontSize: "12px", color: "#64748b" }}>
												Total Findings
											</div>
											<strong style={{ fontSize: "24px", color: "#0f172a" }}>
												{scanSummary.totals.findingCount}
											</strong>
										</div>
										<div
											style={{
												background: "#f8fafc",
												border: "1px solid #e2e8f0",
												padding: "14px",
												borderRadius: "8px",
											}}
										>
											<div style={{ fontSize: "12px", color: "#64748b" }}>
												Total Artifacts
											</div>
											<strong style={{ fontSize: "24px", color: "#0f172a" }}>
												{scanSummary.totals.artifactCount}
											</strong>
										</div>
										<div
											style={{
												background: "#f8fafc",
												border: "1px solid #e2e8f0",
												padding: "14px",
												borderRadius: "8px",
											}}
										>
											<div style={{ fontSize: "12px", color: "#64748b" }}>
												Reviewed Findings
											</div>
											<strong style={{ fontSize: "24px", color: "#0f172a" }}>
												{scanSummary.totals.reviewedFindingCount}
											</strong>
										</div>
										<div
											style={{
												background: "#f8fafc",
												border: "1px solid #e2e8f0",
												padding: "14px",
												borderRadius: "8px",
											}}
										>
											<div style={{ fontSize: "12px", color: "#64748b" }}>
												Decided Findings
											</div>
											<strong style={{ fontSize: "24px", color: "#0f172a" }}>
												{scanSummary.totals.decidedFindingCount}
											</strong>
										</div>
									</div>
								</div>
							</div>
						) : (
							<div
								className="tree-info"
								style={{ padding: "40px 20px", textAlign: "center" }}
							>
								Select a finding from the list to view its details and
								trigger/review LLM assessments.
							</div>
						)}
					</>
				)}
			</section>
		</main>
	);
};
