import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	Activity,
	BarChart3,
	Braces,
	CheckCircle2,
	ChevronRight,
	Copy,
	FileCode2,
	FolderOpen,
	GitBranch,
	Plus,
	RefreshCw,
	Shield,
} from "lucide-react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { formatCommandTokens } from "../../../../shared/format-command";
import type {
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceOntologyHandoff } from "../../../../shared/schemas/static-intelligence-module.schema";
import {
	browseProjectFolder,
	createProject,
	fetchProjectIntelligenceSummaries,
	fetchProjectIntelligenceView,
	fetchProjectOntologyHandoff,
	fetchProjectStructure,
	fetchScanIntelligenceAgentQuery,
	fetchScans,
	type ProjectIntelligenceProject,
	type ProjectIntelligenceSummary,
	type ProjectIntelligenceView,
	type ProjectStructureListResponse,
	refreshProjectIntelligence,
	type ScanIntelligenceAgentMode,
	type ScanRun,
} from "../../api";
import { Button, SelectInput, TextInput } from "../../ui";
import { formatScanOutcome } from "../scans/scan-profile-display";
import { formatDateTime } from "../scans/scans-utils";
import { readinessPresentation } from "./project-intelligence-readiness";
import { buildProjectCardSummary } from "./project-intelligence-view-model";

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
};

const severityOrder = {
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
	const [projects, setProjects] = useState<ProjectIntelligenceProject[]>([]);
	const [summaryByProjectId, setSummaryByProjectId] = useState<
		Record<string, ProjectIntelligenceSummary | null>
	>({});
	const [selectedView, setSelectedView] =
		useState<ProjectIntelligenceView | null>(null);
	const [structure, setStructure] =
		useState<ProjectStructureListResponse | null>(null);
	const [ontologyHandoff, setOntologyHandoff] =
		useState<StaticIntelligenceOntologyHandoff | null>(null);
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [loading, setLoading] = useState(false);
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
					projects.find((item) => item.id === routeState.projectId) ??
					null)
				: null,
		[projects, routeState.projectId, visibleView?.project],
	);

	const selectedScanRunId =
		routeState.scanRunId ?? visibleView?.selection.selectedScanRunId ?? null;
	const selectedExport = visibleView?.export ?? null;

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

	const loadSelectedProject = useCallback(async () => {
		if (!routeState.projectId) {
			setSelectedView(null);
			setScanRuns([]);
			return;
		}
		const requestId = ++detailRequestId.current;
		setLoading(true);
		try {
			const [view, scans] = await Promise.all([
				fetchProjectIntelligenceView(
					routeState.projectId,
					routeState.scanRunId,
				),
				fetchScans(routeState.projectId),
			]);
			const scanRunId = view.selection.selectedScanRunId;
			let nextStructure: ProjectStructureListResponse | null = null;
			let nextHandoff: StaticIntelligenceOntologyHandoff | null = null;
			if (routeState.tab === "intelligence" && scanRunId && view.generation) {
				const [structureResult, handoffResult] = await Promise.all([
					fetchProjectStructure(routeState.projectId, scanRunId, {
						generationId: view.generation.generationId,
					}),
					fetchProjectOntologyHandoff(
						routeState.projectId,
						scanRunId,
						view.generation.generationId,
					),
				]);
				nextStructure = structureResult;
				nextHandoff = handoffResult;
			}
			if (requestId !== detailRequestId.current) return;
			setSelectedView(view);
			setScanRuns(scans);
			setStructure(nextStructure);
			setOntologyHandoff(nextHandoff);
		} catch (error) {
			if (requestId === detailRequestId.current)
				setErrorText(
					error instanceof Error
						? error.message
						: "Failed to load Project Intelligence.",
				);
		} finally {
			if (requestId === detailRequestId.current) setLoading(false);
		}
	}, [
		routeState.projectId,
		routeState.scanRunId,
		routeState.tab,
		setErrorText,
	]);

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
				await loadSelectedProject();
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
			<div className="projects-head">
				<div>
					<h1>{routeState.projectId ? "Project Intelligence" : "Projects"}</h1>
					<p>
						登録済みプロジェクトの分析結果、Static Intelligence source、
						Scans履歴を確認します。
					</p>
				</div>
				<div className="projects-head-actions">
					<Button
						type="button"
						variant="secondary"
						onClick={() =>
							void (routeState.projectId
								? loadSelectedProject()
								: loadProjects())
						}
						disabled={loading}
					>
						<RefreshCw className="icon" />
						Refresh
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

			{registerOpen ? (
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
					activeTab={routeState.tab}
					selectedScanRunId={selectedScanRunId}
					selectedExport={selectedExport}
					structure={structure}
					ontologyHandoff={ontologyHandoff}
					refreshing={refreshing}
					onRefreshAnalysis={() => void handleRefreshAnalysis()}
					onScanChange={(scanRunId) =>
						void navigate({
							to: "/projects/$projectId/intelligence",
							params: { projectId: routeState.projectId as string },
							search: { scanRunId },
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
	return { projectId, tab, scanRunId };
}
