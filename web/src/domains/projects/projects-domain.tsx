import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	browseProjectFolder,
	createProject,
	fetchProjectIntelligenceSummaries,
	fetchProjectIntelligenceView,
	fetchScanIntelligenceAgentQuery,
	fetchScans,
	type ProjectIntelligenceProject,
	type ProjectIntelligenceSummary,
	type ProjectIntelligenceView,
	refreshProjectIntelligence,
	type ScanIntelligenceAgentMode,
	type ScanRun,
} from "../../api";
import { Button } from "../../ui";
import {
	type IntelligenceViewId,
	parseFocusPath,
	parseIntelligenceViewId,
	parseModuleId,
} from "./project-intelligence-tab-model";
import {
	ProjectDetail,
	ProjectRegistrationPanel,
	ProjectsList,
} from "./project-overview-panels";

type ProjectsDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (text: string | null) => void;
};

type ProjectRouteState = {
	projectId: string | null;
	tab: "list" | "overview" | "intelligence";
	scanRunId: string | null;
	intelligenceView: IntelligenceViewId;
	focusPath: string | null;
	moduleId: string | null;
};

type DetailRequestState = {
	key: string | null;
	status: "idle" | "loading" | "loaded" | "failed";
};

const _severityOrder = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

export function ProjectsDomainSection({
	active,
	runWithBusy,
	setErrorText,
}: ProjectsDomainSectionProps) {
	const navigate = useNavigate();
	const routeState = useProjectRouteState();
	const detailRouteKey = routeState.projectId
		? `${routeState.projectId}:${routeState.scanRunId ?? ""}:${routeState.tab}`
		: null;
	const [projects, setProjects] = useState<ProjectIntelligenceProject[]>([]);
	const [summaryByProjectId, setSummaryByProjectId] = useState<
		Record<string, ProjectIntelligenceSummary | null>
	>({});
	const [selectedView, setSelectedView] =
		useState<ProjectIntelligenceView | null>(null);
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [loading, setLoading] = useState(false);
	const [detailRequest, setDetailRequest] = useState<DetailRequestState>({
		key: null,
		status: "idle",
	});
	const [refreshing, setRefreshing] = useState(false);
	const listRequestId = useRef(0);
	const detailRequestId = useRef(0);
	const agentRequestId = useRef(0);
	const routeStateRef = useRef(routeState);
	routeStateRef.current = routeState;
	const [registerOpen, setRegisterOpen] = useState(false);
	const [projectPath, setProjectPath] = useState("");
	const [defaultBranch, setDefaultBranch] = useState("main");
	const [browseLoading, setBrowseLoading] = useState(false);
	const [agentMode, setAgentMode] =
		useState<ScanIntelligenceAgentMode>("overview");
	const [agentPreview, setAgentPreview] = useState<Awaited<
		ReturnType<typeof fetchScanIntelligenceAgentQuery>
	> | null>(null);
	const [agentLoading, setAgentLoading] = useState(false);

	const visibleView = useMemo(() => {
		if (!selectedView || selectedView.project.id !== routeState.projectId)
			return null;
		if (
			routeState.scanRunId &&
			selectedView.selection.selectedScanRunId !== routeState.scanRunId
		)
			return null;
		if (
			!routeState.scanRunId &&
			selectedView.selection.requestedScanRunId !== null
		)
			return null;
		return selectedView;
	}, [routeState.projectId, routeState.scanRunId, selectedView]);

	const selectedProject = useMemo(
		() =>
			routeState.projectId
				? (visibleView?.project ??
					(selectedView?.project.id === routeState.projectId
						? selectedView.project
						: null) ??
					projects.find((item) => item.id === routeState.projectId) ??
					null)
				: null,
		[projects, routeState.projectId, selectedView, visibleView?.project],
	);

	const selectedScanRunId =
		routeState.scanRunId ?? visibleView?.selection.selectedScanRunId ?? null;
	const selectedExport = visibleView?.export ?? null;
	const detailLoading = Boolean(
		detailRouteKey &&
			(detailRequest.key !== detailRouteKey ||
				detailRequest.status === "loading"),
	);
	const detailLoadFailed = Boolean(
		detailRouteKey &&
			detailRequest.key === detailRouteKey &&
			detailRequest.status === "failed",
	);

	const loadProjects = useCallback(async () => {
		const requestId = ++listRequestId.current;
		setLoading(true);
		try {
			const summaries = await fetchProjectIntelligenceSummaries();
			if (requestId !== listRequestId.current) return;
			setProjects(summaries.map((summary) => summary.project));
			setSummaryByProjectId(
				Object.fromEntries(
					summaries.map((summary) => [summary.projectId, summary]),
				),
			);
		} catch (error) {
			if (requestId === listRequestId.current) {
				setErrorText(
					error instanceof Error ? error.message : "Failed to load projects.",
				);
			}
		} finally {
			if (requestId === listRequestId.current) setLoading(false);
		}
	}, [setErrorText]);

	const loadSelectedProject = useCallback(
		async (preserveView = false) => {
			if (!routeState.projectId) {
				setSelectedView(null);
				setScanRuns([]);
				setDetailRequest({ key: null, status: "idle" });
				return;
			}
			const requestId = ++detailRequestId.current;
			if (!preserveView) {
				setLoading(true);
				setDetailRequest({ key: detailRouteKey, status: "loading" });
			}
			try {
				const [view, scans] = await Promise.all([
					fetchProjectIntelligenceView(
						routeState.projectId,
						routeState.scanRunId,
					),
					fetchScans(routeState.projectId),
				]);
				if (requestId !== detailRequestId.current) return;
				setSelectedView(view);
				setScanRuns(scans);
				setDetailRequest({ key: detailRouteKey, status: "loaded" });
			} catch (error) {
				if (requestId === detailRequestId.current) {
					if (!preserveView) {
						setDetailRequest({ key: detailRouteKey, status: "failed" });
					}
					setErrorText(
						error instanceof Error
							? error.message
							: "Failed to load Project Intelligence.",
					);
				}
			} finally {
				if (requestId === detailRequestId.current && !preserveView) {
					setLoading(false);
				}
			}
		},
		[detailRouteKey, routeState.projectId, routeState.scanRunId, setErrorText],
	);

	useEffect(() => {
		if (!active || routeState.projectId) return;
		void loadProjects();
	}, [active, loadProjects, routeState.projectId]);

	useEffect(() => {
		if (!active || !routeState.projectId) return;
		void loadSelectedProject();
	}, [active, loadSelectedProject, routeState.projectId]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset preview when selected scan changes
	useEffect(() => {
		agentRequestId.current += 1;
		setAgentPreview(null);
		setAgentMode("overview");
		setAgentLoading(false);
	}, [selectedScanRunId, visibleView?.generation?.generationId]);

	const handleRefreshAnalysis = async () => {
		if (!routeState.projectId || !selectedScanRunId) return;
		const refreshTarget = {
			projectId: routeState.projectId,
			scanRunId: selectedScanRunId,
			routeScanRunId: routeState.scanRunId,
		};
		setRefreshing(true);
		try {
			await refreshProjectIntelligence(
				refreshTarget.projectId,
				refreshTarget.scanRunId,
			);
			const currentRoute = routeStateRef.current;
			if (
				currentRoute.projectId === refreshTarget.projectId &&
				currentRoute.scanRunId === refreshTarget.routeScanRunId
			) {
				await loadSelectedProject(true);
			}
		} catch (error) {
			setErrorText(
				error instanceof Error ? error.message : "Analysis refresh failed.",
			);
		} finally {
			setRefreshing(false);
		}
	};

	const handleRegister = async (event: FormEvent) => {
		event.preventDefault();
		await runWithBusy(async () => {
			const created = await createProject({
				repoPath: projectPath.trim(),
				defaultBranch: defaultBranch.trim() || "main",
			});
			setRegisterOpen(false);
			setProjectPath("");
			setDefaultBranch("main");
			await navigate({
				to: "/projects/$projectId",
				params: { projectId: created.id },
			});
		});
	};

	const handleBrowse = async () => {
		setBrowseLoading(true);
		try {
			const result = await browseProjectFolder();
			if (result.path) {
				setProjectPath(result.path);
			}
		} catch (error) {
			setErrorText(
				error instanceof Error ? error.message : "Folder picker failed.",
			);
		} finally {
			setBrowseLoading(false);
		}
	};

	const handleLoadAgentPreview = async () => {
		if (!selectedScanRunId || !visibleView?.generation) return;
		const requestId = ++agentRequestId.current;
		setAgentLoading(true);
		try {
			const result = await fetchScanIntelligenceAgentQuery(selectedScanRunId, {
				mode: agentMode,
				generationId: visibleView.generation.generationId,
			});
			if (requestId === agentRequestId.current) setAgentPreview(result);
		} catch (error) {
			if (requestId === agentRequestId.current)
				setErrorText(
					error instanceof Error
						? error.message
						: "Failed to load agent bundle preview.",
				);
		} finally {
			if (requestId === agentRequestId.current) setAgentLoading(false);
		}
	};

	if (!active) return null;

	return (
		<main className="projects-layout">
			{!routeState.projectId ? (
				<div className="projects-head">
					<div>
						<h1>Projects</h1>
						<p>
							登録済みプロジェクトの分析結果、Static Intelligence source、
							Scans履歴を確認します。
						</p>
					</div>
					<div className="projects-head-actions">
						<Button
							type="button"
							variant="secondary"
							onClick={() => void loadProjects()}
							disabled={loading}
						>
							<RefreshCw className="icon" />
							最新状態を再読込
						</Button>
						<Button
							type="button"
							variant="primary"
							onClick={() => setRegisterOpen((value) => !value)}
						>
							<Plus className="icon" />
							Register
						</Button>
					</div>
				</div>
			) : null}

			{!routeState.projectId && registerOpen ? (
				<ProjectRegistrationPanel
					projectPath={projectPath}
					defaultBranch={defaultBranch}
					browseLoading={browseLoading}
					onProjectPathChange={setProjectPath}
					onDefaultBranchChange={setDefaultBranch}
					onBrowse={() => void handleBrowse()}
					onSubmit={handleRegister}
				/>
			) : null}

			{routeState.projectId ? (
				<ProjectDetail
					project={selectedProject}
					view={visibleView}
					scanRuns={scanRuns}
					loading={detailLoading}
					loadFailed={detailLoadFailed}
					activeTab={routeState.tab}
					intelligenceView={routeState.intelligenceView}
					focusPath={routeState.focusPath}
					moduleId={routeState.moduleId}
					selectedScanRunId={selectedScanRunId}
					selectedExport={selectedExport}
					refreshing={refreshing}
					onRefreshAnalysis={() => void handleRefreshAnalysis()}
					onScanChange={(scanRunId) =>
						void navigate({
							to: "/projects/$projectId/intelligence",
							params: { projectId: routeState.projectId as string },
							search: {
								scanRunId,
								intelligenceView: routeState.intelligenceView,
							},
						})
					}
					agentMode={agentMode}
					agentPreview={agentPreview}
					agentLoading={agentLoading}
					onAgentModeChange={setAgentMode}
					onLoadAgentPreview={() => void handleLoadAgentPreview()}
				/>
			) : (
				<ProjectsList
					projects={projects}
					summaries={summaryByProjectId}
					loading={loading}
				/>
			)}
		</main>
	);
}

function useProjectRouteState(): ProjectRouteState {
	const location = useRouterState({ select: (state) => state.location });
	const parts = location.pathname.split("/").filter(Boolean);
	const projectId = parts[0] === "projects" && parts[1] ? parts[1] : null;
	const tab =
		parts[0] !== "projects"
			? "list"
			: parts[2] === "intelligence"
				? "intelligence"
				: projectId
					? "overview"
					: "list";
	const scanRunId =
		new URLSearchParams(location.searchStr).get("scanRunId") ?? null;
	const search = new URLSearchParams(location.searchStr);
	const intelligenceView = parseIntelligenceViewId(
		search.get("intelligenceView"),
	);
	const focusPath = parseFocusPath(search.get("focusPath"));
	const moduleId = parseModuleId(search.get("moduleId"));
	return { projectId, tab, scanRunId, intelligenceView, focusPath, moduleId };
}
