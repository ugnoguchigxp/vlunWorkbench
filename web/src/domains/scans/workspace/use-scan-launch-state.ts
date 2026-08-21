import { useRouterState } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import type {
	DiffScanPreview,
	Project,
	ScanEvent,
	ScanProfile,
	ScanRun,
	ScanTargetKind,
} from "../../../api";

export type ScanListTab = "runs" | "findings";
export type ScanDetailTab = "review" | "verification" | "report";
export type ActionQueueFilter =
	| "active"
	| "all"
	| "needs_review"
	| "needs_verification"
	| "ready_for_report"
	| "blocked_by_evidence";

export function useScanLaunchState() {
	const location = useRouterState({ select: (state) => state.location });
	const requestedSearch = useMemo(
		() => new URLSearchParams(location.searchStr),
		[location.searchStr],
	);
	const requestedProjectId = requestedSearch.get("projectId") ?? "";
	const requestedScanRunId = requestedSearch.get("scanRunId") ?? "";
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedProjectId, setSelectedProjectId] =
		useState(requestedProjectId);
	const [projectFolderPath, setProjectFolderPath] = useState("");
	const [projectDefaultBranch, setProjectDefaultBranch] = useState("main");
	const [projectCreateLoading, setProjectCreateLoading] = useState(false);
	const [projectBrowseLoading, setProjectBrowseLoading] = useState(false);
	const [showNewProjectModal, setShowNewProjectModal] = useState(false);
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [scanRunsLoading, setScanRunsLoading] = useState(true);
	const [scanEvents, setScanEvents] = useState<ScanEvent[]>([]);
	const [activeScanEvents, setActiveScanEvents] = useState<ScanEvent[]>([]);
	const [selectedScanRunId, setSelectedScanRunId] =
		useState(requestedScanRunId);
	const [scanListTab, setScanListTab] = useState<ScanListTab>("runs");
	const [scanDetailTab, setScanDetailTab] = useState<ScanDetailTab>("review");
	const [actionQueueFilter, setActionQueueFilter] =
		useState<ActionQueueFilter>("active");
	const [profiles, setProfiles] = useState<ScanProfile[]>([]);
	const [selectedProfileId, setSelectedProfileId] = useState("baseline");
	const [scanTargetKind, setScanTargetKind] = useState<ScanTargetKind>("full");
	const [diffBaseRef, setDiffBaseRef] = useState("HEAD");
	const [diffHeadRef, setDiffHeadRef] = useState("HEAD");
	const [diffIncludeUntracked, setDiffIncludeUntracked] = useState(true);
	const [diffPreview, setDiffPreview] = useState<DiffScanPreview | null>(null);
	const [diffPreviewResolvedInputKey, setDiffPreviewResolvedInputKey] =
		useState<string | null>(null);
	const [diffPreviewLoading, setDiffPreviewLoading] = useState(false);
	const [diffPreviewError, setDiffPreviewError] = useState<string | null>(null);
	const diffPreviewRequestIdRef = useRef(0);
	const [continueOnToolFailure, setContinueOnToolFailure] = useState(true);
	const [scanProjectCodeExecutionConsent, setScanProjectCodeExecutionConsent] =
		useState(false);
	const [timeoutSec, setTimeoutSec] = useState(600);
	const [showRunScanForm, setShowRunScanForm] = useState(false);
	const [isScanning, setIsScanning] = useState(false);

	return {
		actionQueueFilter,
		activeScanEvents,
		continueOnToolFailure,
		diffBaseRef,
		diffHeadRef,
		diffIncludeUntracked,
		diffPreview,
		diffPreviewError,
		diffPreviewLoading,
		diffPreviewRequestIdRef,
		diffPreviewResolvedInputKey,
		isScanning,
		location,
		profiles,
		projectBrowseLoading,
		projectCreateLoading,
		projectDefaultBranch,
		projectFolderPath,
		projects,
		requestedProjectId,
		requestedScanRunId,
		requestedSearch,
		scanDetailTab,
		scanEvents,
		scanListTab,
		scanProjectCodeExecutionConsent,
		scanRuns,
		scanRunsLoading,
		scanTargetKind,
		selectedProfileId,
		selectedProjectId,
		selectedScanRunId,
		setActionQueueFilter,
		setActiveScanEvents,
		setContinueOnToolFailure,
		setDiffBaseRef,
		setDiffHeadRef,
		setDiffIncludeUntracked,
		setDiffPreview,
		setDiffPreviewError,
		setDiffPreviewLoading,
		setDiffPreviewResolvedInputKey,
		setIsScanning,
		setProfiles,
		setProjectBrowseLoading,
		setProjectCreateLoading,
		setProjectDefaultBranch,
		setProjectFolderPath,
		setProjects,
		setScanDetailTab,
		setScanEvents,
		setScanListTab,
		setScanProjectCodeExecutionConsent,
		setScanRuns,
		setScanRunsLoading,
		setScanTargetKind,
		setSelectedProfileId,
		setSelectedProjectId,
		setSelectedScanRunId,
		setShowNewProjectModal,
		setShowRunScanForm,
		setTimeoutSec,
		showNewProjectModal,
		showRunScanForm,
		timeoutSec,
	};
}

export type ScanLaunchState = ReturnType<typeof useScanLaunchState>;
