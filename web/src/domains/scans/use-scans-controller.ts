import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";
import {
	browseProjectFolder,
	createFindingDecision,
	createProject,
	type DynamicArtifact,
	type DynamicEvidence,
	type DynamicProfileConfig,
	type DynamicRun,
	type Finding,
	type FindingDecision,
	type FindingEvidence,
	type FindingGroup,
	type FindingReview,
	fetchDynamicRunArtifacts,
	fetchFinding,
	fetchFindingDecisions,
	fetchFindingDynamicRuns,
	fetchFindingReproductions,
	fetchFindingReviews,
	fetchProjectDynamicProfiles,
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
	triggerFindingDynamicRun,
	triggerFindingReproduction,
	triggerFindingReview,
} from "../../api";
import { useDastController } from "./use-dast-controller";

const basenameFromPath = (value: string): string => {
	const normalized = value.replace(/\/+$/, "");
	const parts = normalized.split("/");
	return parts.at(-1) || normalized || "Local project";
};

export type ScansDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (text: string | null) => void;
};
type FindingDetails = {
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
};
export const useScansController = ({
	active,
	busy,
	runWithBusy,
	setErrorText,
}: ScansDomainSectionProps) => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedProjectId, setSelectedProjectId] = useState("");
	const [projectFolderPath, setProjectFolderPath] = useState("");
	const [projectNameInput, setProjectNameInput] = useState("");
	const [projectDefaultBranch, setProjectDefaultBranch] = useState("main");
	const [projectCreateLoading, setProjectCreateLoading] = useState(false);
	const [projectBrowseLoading, setProjectBrowseLoading] = useState(false);
	const [showNewProjectModal, setShowNewProjectModal] = useState(false);
	const [launchMode, setLaunchMode] = useState<"static" | "dast">("static");
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [selectedScanRunId, setSelectedScanRunId] = useState("");
	const [findings, setFindings] = useState<Finding[]>([]);
	const [selectedFindingId, setSelectedFindingId] = useState("");
	const [profiles, setProfiles] = useState<ScanProfile[]>([]);
	const [selectedProfileId, setSelectedProfileId] = useState("baseline");
	const [continueOnToolFailure, setContinueOnToolFailure] = useState(true);
	const [timeoutSec, setTimeoutSec] = useState(600);
	const [showRunScanForm, setShowRunScanForm] = useState(false);
	const [isScanning, setIsScanning] = useState(false);
	const [scanSummary, setScanSummary] = useState<ScanRunSummary | null>(null);
	const [scanGroups, setScanGroups] = useState<FindingGroup[]>([]);
	const [selectedGroupId, setSelectedGroupId] = useState("");
	const [findingsViewMode, setFindingsViewMode] = useState<"list" | "grouped">(
		"list",
	);
	const [selectedFindingDetails, setSelectedFindingDetails] =
		useState<FindingDetails | null>(null);
	const [allReviews, setAllReviews] = useState<FindingReview[]>([]);
	const [reviewLoading, setReviewLoading] = useState(false);
	const [allDecisions, setAllDecisions] = useState<FindingDecision[]>([]);
	const [decisionInput, setDecisionInput] =
		useState<FindingDecision["decision"]>("accepted");
	const [reasonInput, setReasonInput] = useState<FindingDecision["reason"]>(
		"confirmed_by_evidence",
	);
	const [commentInput, setCommentInput] = useState("");
	const [linkReviewInput, setLinkReviewInput] = useState(false);
	const [decisionSubmitLoading, setDecisionSubmitLoading] = useState(false);
	const [viewingReport, setViewingReport] = useState(false);
	const [reportLoading, setReportLoading] = useState(false);
	const [reports, setReports] = useState<ScanReport[]>([]);
	const [selectedReport, setSelectedReport] = useState<ScanReport | null>(null);
	const [reportPreviewContent, setReportPreviewContent] = useState<
		string | null
	>(null);
	const [reportTitle, setReportTitle] = useState("Security Report");
	const [includeFalsePositives, setIncludeFalsePositives] = useState(true);
	const [includeDeferred, setIncludeDeferred] = useState(true);
	const [includeUndecided, setIncludeUndecided] = useState(true);
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
	const dast = useDastController({
		active,
		selectedProjectId,
		setScanRuns,
		setSelectedScanRunId,
	});

	useEffect(() => {
		if (!active) return;
		void fetchProjects()
			.then((items) => {
				setProjects(items);
				if (items[0] && !selectedProjectId) setSelectedProjectId(items[0].id);
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error ? err.message : "Failed to load projects.",
				),
			);
	}, [active, selectedProjectId, setErrorText]);

	useEffect(() => {
		if (!active || !selectedProjectId) return;
		void fetchScans(selectedProjectId)
			.then((runs) => {
				setScanRuns(runs);
				setSelectedScanRunId(runs[0]?.id ?? "");
				if (!runs[0]) {
					setFindings([]);
					setSelectedFindingId("");
					setSelectedFindingDetails(null);
				}
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error ? err.message : "Failed to load scans.",
				),
			);
	}, [active, selectedProjectId, setErrorText]);

	useEffect(() => {
		if (!active || !selectedScanRunId) return;
		void fetchScanFindings(selectedScanRunId)
			.then((items) => {
				setFindings(items);
				setSelectedFindingId(items[0]?.id ?? "");
				if (!items[0]) setSelectedFindingDetails(null);
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error ? err.message : "Failed to load findings.",
				),
			);
	}, [active, selectedScanRunId, setErrorText]);

	useEffect(() => {
		if (!active) return;
		void fetchScanProfiles().then(setProfiles).catch(console.error);
	}, [active]);

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setScanSummary(null);
			setScanGroups([]);
			setSelectedGroupId("");
			return;
		}
		void fetchScanSummary(selectedScanRunId)
			.then(setScanSummary)
			.catch(() => setScanSummary(null));
		void fetchScanGroups(selectedScanRunId)
			.then(({ groups }) => setScanGroups(groups))
			.catch(() => setScanGroups([]));
	}, [active, selectedScanRunId]);

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setReports([]);
			setSelectedReport(null);
			setReportPreviewContent(null);
			return;
		}
		void fetchScanReports(selectedScanRunId).then((items) => {
			setReports(items);
			setSelectedReport(items[0] ?? null);
			if (!items[0]) setReportPreviewContent(null);
		});
	}, [active, selectedScanRunId]);

	useEffect(() => {
		if (!active || selectedReport?.status !== "completed") {
			setReportPreviewContent(null);
			return;
		}
		void fetch(`/api/scan-reports/${selectedReport.id}/download`)
			.then((response) => (response.ok ? response.text() : null))
			.then(setReportPreviewContent)
			.catch(() => setReportPreviewContent(null));
	}, [active, selectedReport]);

	const loadFindingDetails = useCallback(
		async (findingId: string, quiet = false) => {
			const fetchAction = async () => {
				const res = await fetchFinding(findingId);
				setSelectedFindingDetails(res);
				await Promise.all([
					fetchFindingReviews(findingId)
						.then(({ reviews }) => setAllReviews(reviews))
						.catch(() => setAllReviews([])),
					fetchFindingDecisions(findingId)
						.then(({ decisions }) => setAllDecisions(decisions))
						.catch(() => setAllDecisions([])),
					fetchReproductionProfiles(findingId)
						.then(({ profiles }) => {
							setReproProfiles(profiles);
							setSelectedReproProfile(
								profiles.find((p) => p.isApplicable)?.id ?? "",
							);
						})
						.catch(() => {
							setReproProfiles([]);
							setSelectedReproProfile("");
						}),
					fetchFindingReproductions(findingId)
						.then(({ reproductions }) => setReproRuns(reproductions))
						.catch(() => setReproRuns([])),
					fetchProjectDynamicProfiles(res.finding.projectId)
						.then(({ configs }) => {
							setDynamicProfiles(configs);
							setSelectedDynamicProfile(
								configs.find((p) => p.enabled)?.profileId ?? "",
							);
						})
						.catch(() => {
							setDynamicProfiles([]);
							setSelectedDynamicProfile("");
						}),
					fetchFindingDynamicRuns(findingId)
						.then(({ dynamicRuns }) => setDynamicRuns(dynamicRuns))
						.catch(() => setDynamicRuns([])),
				]);
			};
			if (quiet) {
				await fetchAction().catch((err) =>
					console.error("Failed to silently reload finding details:", err),
				);
			} else {
				await runWithBusy(fetchAction);
			}
		},
		[runWithBusy],
	);

	useEffect(() => {
		if (active && selectedFindingId) void loadFindingDetails(selectedFindingId);
	}, [active, selectedFindingId, loadFindingDetails]);

	useEffect(() => {
		setDecisionInput("accepted");
		setReasonInput("confirmed_by_evidence");
		setCommentInput("");
		setLinkReviewInput(false);
	}, []);

	useEffect(() => {
		if (
			!active ||
			!selectedFindingId ||
			selectedFindingDetails?.latestReview?.status !== "running"
		)
			return;
		let mounted = true;
		const poll = setInterval(() => {
			void fetchFinding(selectedFindingId)
				.then((res) => {
					if (!mounted) return;
					setSelectedFindingDetails(res);
					if (res.latestReview?.status !== "running") {
						clearInterval(poll);
						void fetchFindingReviews(selectedFindingId).then(({ reviews }) =>
							setAllReviews(reviews),
						);
					}
				})
				.catch(console.error);
		}, 2500);
		return () => {
			mounted = false;
			clearInterval(poll);
		};
	}, [active, selectedFindingId, selectedFindingDetails?.latestReview?.status]);

	const handleStartScanProfile = async () => {
		if (!selectedProjectId || !selectedProfileId || timeoutSec <= 0) return;
		setIsScanning(true);
		setErrorText(null);
		try {
			const res = await startScan(selectedProjectId, {
				profile: selectedProfileId,
				continueOnToolFailure,
				timeoutSec,
			});
			setScanRuns(await fetchScans(selectedProjectId));
			if (res.scan?.id) {
				setSelectedScanRunId(res.scan.id);
				setSelectedFindingId("");
				setSelectedFindingDetails(null);
			}
			setShowRunScanForm(false);
		} catch (err) {
			setErrorText(err instanceof Error ? err.message : "Scan failed to run.");
		} finally {
			setIsScanning(false);
		}
	};

	const handleSelectProjectFolder = (path: string) => {
		setProjectFolderPath(path);
		if (!projectNameInput.trim()) {
			setProjectNameInput(basenameFromPath(path));
		}
	};

	const handleBrowseProjectFolder = async () => {
		setProjectBrowseLoading(true);
		setErrorText(null);
		try {
			const res = await browseProjectFolder();
			if (res.path) handleSelectProjectFolder(res.path);
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Failed to select project folder.",
			);
		} finally {
			setProjectBrowseLoading(false);
		}
	};

	const handleCreateProjectFromFolder = async () => {
		const repoPath = projectFolderPath.trim();
		const name = projectNameInput.trim() || basenameFromPath(repoPath);
		if (!repoPath || !name) return;

		setProjectCreateLoading(true);
		setErrorText(null);
		try {
			const created = await createProject({
				name,
				repoPath,
				defaultBranch: projectDefaultBranch.trim() || "main",
			});
			setProjects((prev) => {
				const others = prev.filter((item) => item.id !== created.id);
				return [created, ...others];
			});
			setSelectedProjectId(created.id);
			setProjectFolderPath(created.repoPath);
			setProjectNameInput(created.name);
			setShowNewProjectModal(false);
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "Failed to register project folder.",
			);
		} finally {
			setProjectCreateLoading(false);
		}
	};

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
			setSelectedReport(
				list.find((item) => item.id === res.report.id) ?? res.report,
			);
			setViewingReport(true);
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Failed to generate report.",
			);
		} finally {
			setReportLoading(false);
		}
	};

	const handleTriggerReview = async () => {
		if (!selectedFindingId) return;
		setReviewLoading(true);
		setErrorText(null);
		try {
			const res = await triggerFindingReview(selectedFindingId);
			if (res.ok) await loadFindingDetails(selectedFindingId, true);
			else setErrorText(res.error || "Failed to trigger LLM review.");
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Failed to trigger LLM review.",
			);
		} finally {
			setReviewLoading(false);
		}
	};

	const handleDecisionSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (!selectedFindingId) return;
		setDecisionSubmitLoading(true);
		try {
			await createFindingDecision(selectedFindingId, {
				decision: decisionInput,
				reason: reasonInput,
				comment: commentInput || undefined,
				linkedReviewId:
					linkReviewInput && selectedFindingDetails?.latestReview
						? selectedFindingDetails.latestReview.id
						: undefined,
			});
			await loadFindingDetails(selectedFindingId, true);
			if (selectedScanRunId)
				setFindings(await fetchScanFindings(selectedScanRunId));
			setCommentInput("");
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Failed to record decision.",
			);
		} finally {
			setDecisionSubmitLoading(false);
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
			if (res.reproductionRunId) await openReproRun(res.reproductionRunId);
			setReproRuns(
				(await fetchFindingReproductions(selectedFindingId)).reproductions,
			);
		} catch (err) {
			setReproError(
				err instanceof Error ? err.message : "Failed to trigger reproduction.",
			);
		} finally {
			setReproLoading(false);
		}
	};

	const openReproRun = async (runId: string) => {
		setExpandedReproRunId(runId);
		const res = await fetchReproductionRunArtifacts(runId);
		setReproRunArtifacts((prev) => ({ ...prev, [runId]: res.artifacts }));
		setReproRunEvidence((prev) => ({ ...prev, [runId]: res.evidence }));
	};

	const handleToggleReproRun = async (runId: string) => {
		if (expandedReproRunId === runId) return setExpandedReproRunId(null);
		if (reproRunArtifacts[runId]) return setExpandedReproRunId(runId);
		await openReproRun(runId).catch(console.error);
	};

	const handleTriggerDynamic = async () => {
		if (!selectedFindingId || !selectedDynamicProfile) return;
		const profile = dynamicProfiles.find(
			(item) => item.profileId === selectedDynamicProfile,
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
			if (res.dynamicRunId) await openDynamicRun(res.dynamicRunId);
			setDynamicRuns(
				(await fetchFindingDynamicRuns(selectedFindingId)).dynamicRuns,
			);
		} catch (err) {
			setDynamicError(
				err instanceof Error ? err.message : "Failed to trigger dynamic check.",
			);
		} finally {
			setDynamicLoading(false);
		}
	};

	const openDynamicRun = async (runId: string) => {
		setExpandedDynamicRunId(runId);
		const res = await fetchDynamicRunArtifacts(runId);
		setDynamicRunArtifacts((prev) => ({ ...prev, [runId]: res.artifacts }));
		setDynamicRunEvidence((prev) => ({ ...prev, [runId]: res.evidence }));
	};

	const handleToggleDynamicRun = async (runId: string) => {
		if (expandedDynamicRunId === runId) return setExpandedDynamicRunId(null);
		if (dynamicRunArtifacts[runId]) return setExpandedDynamicRunId(runId);
		await openDynamicRun(runId).catch(console.error);
	};

	const displayedFindings =
		findingsViewMode === "grouped" && selectedGroupId
			? findings.filter((item) =>
					scanGroups
						.find((group) => group.id === selectedGroupId)
						?.findingIds.includes(item.id),
				)
			: findings;
	const selectedProject =
		projects.find((project) => project.id === selectedProjectId) ?? null;

	return {
		active,
		busy,
		projects,
		selectedProject,
		selectedProjectId,
		setSelectedProjectId,
		projectFolderPath,
		setProjectFolderPath,
		projectNameInput,
		setProjectNameInput,
		projectDefaultBranch,
		setProjectDefaultBranch,
		projectCreateLoading,
		projectBrowseLoading,
		showNewProjectModal,
		setShowNewProjectModal,
		handleBrowseProjectFolder,
		handleSelectProjectFolder,
		handleCreateProjectFromFolder,
		launchMode,
		setLaunchMode,
		scanRuns,
		selectedScanRunId,
		setSelectedScanRunId,
		findings,
		selectedFindingId,
		setSelectedFindingId,
		profiles,
		selectedProfileId,
		setSelectedProfileId,
		continueOnToolFailure,
		setContinueOnToolFailure,
		timeoutSec,
		setTimeoutSec,
		showRunScanForm,
		setShowRunScanForm,
		isScanning,
		scanSummary,
		scanGroups,
		selectedGroupId,
		setSelectedGroupId,
		findingsViewMode,
		setFindingsViewMode,
		selectedFindingDetails,
		allReviews,
		reviewLoading,
		allDecisions,
		decisionInput,
		setDecisionInput,
		reasonInput,
		setReasonInput,
		commentInput,
		setCommentInput,
		linkReviewInput,
		setLinkReviewInput,
		decisionSubmitLoading,
		viewingReport,
		setViewingReport,
		reportLoading,
		reports,
		selectedReport,
		setSelectedReport,
		reportPreviewContent,
		reportTitle,
		setReportTitle,
		includeFalsePositives,
		setIncludeFalsePositives,
		includeDeferred,
		setIncludeDeferred,
		includeUndecided,
		setIncludeUndecided,
		reproProfiles,
		reproRuns,
		selectedReproProfile,
		setSelectedReproProfile,
		reproLoading,
		reproError,
		expandedReproRunId,
		reproRunArtifacts,
		reproRunEvidence,
		dynamicProfiles,
		dynamicRuns,
		selectedDynamicProfile,
		setSelectedDynamicProfile,
		dynamicLoading,
		dynamicError,
		expandedDynamicRunId,
		dynamicRunArtifacts,
		dynamicRunEvidence,
		allowProjectScriptsConsent,
		setAllowProjectScriptsConsent,
		...dast,
		displayedFindings,
		handleStartScanProfile,
		handleGenerateReport,
		handleTriggerReview,
		handleDecisionSubmit,
		handleTriggerReproduction,
		handleToggleReproRun,
		handleTriggerDynamic,
		handleToggleDynamicRun,
	};
};
export type ScansController = ReturnType<typeof useScansController>;
