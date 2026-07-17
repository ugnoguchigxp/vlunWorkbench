import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	Activity,
	AlertTriangle,
	BarChart3,
	Braces,
	CheckCircle2,
	ChevronRight,
	Copy,
	FileCode2,
	FolderOpen,
	GitBranch,
	Network,
	Plus,
	RefreshCw,
	Shield,
} from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	DiagnosticEvidenceGraph,
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../../../shared/schemas/static-intelligence.schema";
import {
	agentModeToQueryKind,
	browseProjectFolder,
	createProject,
	fetchProjectIntelligenceSummaries,
	fetchProjectIntelligenceStructure,
	fetchProjectStructureSummary,
	fetchProjectIntelligenceView,
	fetchProjectOntologyHandoff,
	fetchScanIntelligenceAgentQuery,
	fetchScans,
	refreshProjectIntelligence,
	type ProjectIntelligenceProject,
	type ProjectIntelligenceSummary,
	type ProjectIntelligenceView,
	type ProjectStructureListResponse,
	type ProjectStructureSummaryResponse,
	type ScanIntelligenceAgentMode,
	type ScanRun,
} from "../../api";
import type { StaticIntelligenceOntologyHandoff } from "../../../../shared/schemas/static-intelligence-module.schema";
import { formatCommandTokens } from "../../../../shared/format-command";
import { Button, SelectInput, TextInput } from "../../ui";
import {
	buildProjectCardSummary,
	countGraphKinds,
} from "./project-intelligence-view-model";
import { formatScanOutcome } from "../scans/scan-profile-display";
import { formatDateTime } from "../scans/scans-utils";
import { readinessPresentation } from "./project-intelligence-readiness";

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

const agentModes: Array<{ id: ScanIntelligenceAgentMode; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "risk", label: "Risk" },
	{ id: "verification", label: "Verification" },
	{ id: "export", label: "Export" },
];

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
	const [projectStructureSummary, setProjectStructureSummary] =
		useState<ProjectStructureSummaryResponse | null>(null);
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
			let nextProjectStructureSummary: ProjectStructureSummaryResponse | null =
				null;
			let nextHandoff: StaticIntelligenceOntologyHandoff | null = null;
			if (routeState.tab === "intelligence" && scanRunId && view.generation) {
				const [structureResult, projectStructureResult, handoffResult] =
					await Promise.all([
						fetchProjectIntelligenceStructure(routeState.projectId, scanRunId, {
							generationId: view.generation.generationId,
						}),
						fetchProjectStructureSummary(
							routeState.projectId,
							scanRunId,
							view.generation.generationId,
						),
						fetchProjectOntologyHandoff(
							routeState.projectId,
							scanRunId,
							view.generation.generationId,
						),
					]);
				nextStructure = structureResult;
				nextProjectStructureSummary = projectStructureResult;
				nextHandoff = handoffResult;
			}
			if (requestId !== detailRequestId.current) return;
			setSelectedView(view);
			setScanRuns(scans);
			setStructure(nextStructure);
			setProjectStructureSummary(nextProjectStructureSummary);
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
					projectStructureSummary={projectStructureSummary}
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

function ProjectRegistrationPanel({
	projectPath,
	defaultBranch,
	browseLoading,
	onProjectPathChange,
	onDefaultBranchChange,
	onBrowse,
	onSubmit,
}: {
	projectPath: string;
	defaultBranch: string;
	browseLoading: boolean;
	onProjectPathChange: (value: string) => void;
	onDefaultBranchChange: (value: string) => void;
	onBrowse: () => void;
	onSubmit: (event: FormEvent) => void;
}) {
	return (
		<section className="projects-band project-registration">
			<div className="projects-section-head">
				<div>
					<h2>Register Project</h2>
					<p>登録だけを行い、scanは自動実行しません。</p>
				</div>
			</div>
			<form className="project-register-grid" onSubmit={onSubmit}>
				<label className="project-path-field" htmlFor="project-register-path">
					<span>Repository Path</span>
					<div className="project-path-input-row">
						<TextInput
							id="project-register-path"
							value={projectPath}
							onChange={(event) => onProjectPathChange(event.target.value)}
							required
						/>
						<Button
							type="button"
							variant="secondary"
							onClick={onBrowse}
							disabled={browseLoading}
						>
							<FolderOpen className="icon" />
							Browse
						</Button>
					</div>
				</label>
				<label htmlFor="project-register-branch">
					<span>Default Branch</span>
					<TextInput
						id="project-register-branch"
						value={defaultBranch}
						onChange={(event) => onDefaultBranchChange(event.target.value)}
					/>
				</label>
				<div className="project-register-actions">
					<Button type="submit" variant="primary">
						<Plus className="icon" />
						Register
					</Button>
				</div>
			</form>
		</section>
	);
}

function ProjectsList({
	projects,
	summaries,
	loading,
}: {
	projects: ProjectIntelligenceProject[];
	summaries: Record<string, ProjectIntelligenceSummary | null>;
	loading: boolean;
}) {
	if (loading && projects.length === 0) {
		return <div className="projects-empty">Loading projects...</div>;
	}
	if (projects.length === 0) {
		return (
			<section className="projects-empty">
				<h2>No registered projects</h2>
				<p>Register a repository to inspect imported analysis results.</p>
			</section>
		);
	}
	return (
		<section className="projects-grid" aria-label="Registered projects">
			{projects.map((project) => {
				const overview = summaries[project.id] ?? null;
				const summary = buildProjectCardSummary(overview);
				return (
					<article className="project-card" key={project.id}>
						<div className="project-card-head">
							<div>
								<h2>{project.repositoryName}</h2>
							</div>
							<StatusBadge status={overview?.generationStatus ?? "missing"} />
						</div>
						<div className="project-metric-grid">
							<Metric label="Risk" value={summary.riskBand} />
							<Metric label="Evidence" value={summary.evidenceQuality} />
							<Metric label="Findings" value={summary.findingCount} />
							<Metric label="Code" value={summary.codeStructureStatus} />
						</div>
						<div className="project-card-foot">
							<div>
								<small>
									<GitBranch className="icon" />
									{project.defaultBranch}
								</small>
								<small>
									<Activity className="icon" />
									{overview?.scanStatus
										? formatScanOutcome(overview.scanStatus)
										: "no scans"}
								</small>
							</div>
							<Link
								to="/projects/$projectId"
								params={{ projectId: project.id }}
								className="project-open-link"
							>
								Open
								<ChevronRight className="icon" />
							</Link>
						</div>
					</article>
				);
			})}
		</section>
	);
}

function ProjectDetail({
	project,
	view,
	scanRuns,
	activeTab,
	selectedScanRunId,
	selectedExport,
	structure,
	projectStructureSummary,
	ontologyHandoff,
	refreshing,
	onRefreshAnalysis,
	onScanChange,
	agentMode,
	agentPreview,
	agentLoading,
	onAgentModeChange,
	onLoadAgentPreview,
}: {
	project: ProjectIntelligenceProject | null;
	view: ProjectIntelligenceView | null;
	scanRuns: ScanRun[];
	activeTab: "list" | "overview" | "intelligence";
	selectedScanRunId: string | null;
	selectedExport: StaticIntelligenceExportV1 | null;
	structure: ProjectStructureListResponse | null;
	projectStructureSummary: ProjectStructureSummaryResponse | null;
	ontologyHandoff: StaticIntelligenceOntologyHandoff | null;
	refreshing: boolean;
	onRefreshAnalysis: () => void;
	onScanChange: (scanRunId: string | undefined) => void;
	agentMode: ScanIntelligenceAgentMode;
	agentPreview: Awaited<
		ReturnType<typeof fetchScanIntelligenceAgentQuery>
	> | null;
	agentLoading: boolean;
	onAgentModeChange: (mode: ScanIntelligenceAgentMode) => void;
	onLoadAgentPreview: () => void;
}) {
	if (!project) {
		return <div className="projects-empty">Project not found.</div>;
	}
	return (
		<>
			<section className="projects-band project-detail-head">
				<div>
					<h2>{project.repositoryName}</h2>
				</div>
				{activeTab === "intelligence" ? (
					<label
						className="project-scan-select"
						htmlFor="project-intelligence-scan"
					>
						<span>Analysis scan</span>
						<SelectInput
							id="project-intelligence-scan"
							value={selectedScanRunId ?? ""}
							onChange={(event) =>
								onScanChange(event.target.value || undefined)
							}
						>
							{scanRuns.map((scan) => (
								<option key={scan.id} value={scan.id}>
									{scan.profile} · {formatScanOutcome(scan.status)} ·{" "}
									{formatDateTime(scan.completedAt ?? scan.createdAt)}
								</option>
							))}
						</SelectInput>
					</label>
				) : null}
				<div className="project-detail-actions">
					<Link
						to="/projects/$projectId"
						params={{ projectId: project.id }}
						className={activeTab === "overview" ? "active" : ""}
					>
						Overview
					</Link>
					<Link
						to="/projects/$projectId/intelligence"
						params={{ projectId: project.id }}
						search={{ scanRunId: undefined }}
						className={activeTab === "intelligence" ? "active" : ""}
					>
						Static Intelligence
					</Link>
					<Link
						to="/scans"
						search={{
							projectId: project.id,
							scanRunId: selectedScanRunId ?? undefined,
						}}
					>
						Scans
					</Link>
				</div>
			</section>

			{activeTab === "intelligence" ? (
				<IntelligenceView
					project={project}
					view={view}
					scanRuns={scanRuns}
					selectedScanRunId={selectedScanRunId}
					selectedExport={selectedExport}
					structure={structure}
					projectStructureSummary={projectStructureSummary}
					ontologyHandoff={ontologyHandoff}
					refreshing={refreshing}
					onRefreshAnalysis={onRefreshAnalysis}
					agentMode={agentMode}
					agentPreview={agentPreview}
					agentLoading={agentLoading}
					onAgentModeChange={onAgentModeChange}
					onLoadAgentPreview={onLoadAgentPreview}
				/>
			) : (
				<ProjectOverview project={project} view={view} scanRuns={scanRuns} />
			)}
		</>
	);
}

function ProjectOverview({
	project,
	view,
	scanRuns,
}: {
	project: ProjectIntelligenceProject;
	view: ProjectIntelligenceView | null;
	scanRuns: ScanRun[];
}) {
	const exportPayload = view?.export ?? null;
	return (
		<>
			<section className="projects-summary-grid">
				<SummaryTile
					icon={<Shield className="icon" />}
					label="Risk Band"
					value={exportPayload?.scanSummary.riskBand ?? "none"}
				/>
				<SummaryTile
					icon={<CheckCircle2 className="icon" />}
					label="Evidence Quality"
					value={exportPayload?.scanSummary.evidenceQuality ?? "missing"}
				/>
				<SummaryTile
					icon={<Activity className="icon" />}
					label="Latest Scan"
					value={
						view?.selectedScan
							? formatScanOutcome(view.selectedScan.status)
							: "none"
					}
				/>
				<SummaryTile
					icon={<FileCode2 className="icon" />}
					label="Code Structure"
					value={view?.readiness.codeStructure.status ?? "missing"}
				/>
			</section>
			<section className="projects-band">
				<div className="projects-section-head">
					<div>
						<h2>Analysis Status</h2>
						<p>
							{view?.selectedScan
								? `Selected scan ${view.selectedScan.id}`
								: "No scan has been imported for this project yet."}
						</p>
					</div>
					<div className="project-section-actions">
						<Link
							to="/projects/$projectId/intelligence"
							params={{ projectId: project.id }}
							search={{ scanRunId: undefined }}
							className="project-open-link"
						>
							Open Intelligence
							<ChevronRight className="icon" />
						</Link>
						<Link
							to="/scans"
							search={{ projectId: undefined, scanRunId: undefined }}
							className="project-open-link"
						>
							Open Scans
							<ChevronRight className="icon" />
						</Link>
					</div>
				</div>
				<DegradedReasons reasons={view?.degradedReasons ?? []} />
				<ScanRunList projectId={project.id} scanRuns={scanRuns} />
			</section>
		</>
	);
}

function IntelligenceView({
	project,
	view,
	scanRuns,
	selectedScanRunId,
	selectedExport,
	structure,
	projectStructureSummary,
	ontologyHandoff,
	refreshing,
	onRefreshAnalysis,
	agentMode,
	agentPreview,
	agentLoading,
	onAgentModeChange,
	onLoadAgentPreview,
}: {
	project: ProjectIntelligenceProject;
	view: ProjectIntelligenceView | null;
	scanRuns: ScanRun[];
	selectedScanRunId: string | null;
	selectedExport: StaticIntelligenceExportV1 | null;
	structure: ProjectStructureListResponse | null;
	projectStructureSummary: ProjectStructureSummaryResponse | null;
	ontologyHandoff: StaticIntelligenceOntologyHandoff | null;
	refreshing: boolean;
	onRefreshAnalysis: () => void;
	agentMode: ScanIntelligenceAgentMode;
	agentPreview: Awaited<
		ReturnType<typeof fetchScanIntelligenceAgentQuery>
	> | null;
	agentLoading: boolean;
	onAgentModeChange: (mode: ScanIntelligenceAgentMode) => void;
	onLoadAgentPreview: () => void;
}) {
	if (!selectedExport || !view?.selectedScan) {
		return (
			<section className="projects-empty">
				<h2>Static Intelligence is not available yet</h2>
				<p>
					{view?.readiness.export.reasonCodes.join(", ") ||
						"Run or import a scan before inspecting project intelligence."}
				</p>
				{view?.selectedScan ? (
					<Button
						type="button"
						variant="primary"
						onClick={onRefreshAnalysis}
						disabled={refreshing}
					>
						<RefreshCw className="icon" />
						{refreshing ? "Refreshing…" : "Refresh Analysis"}
					</Button>
				) : null}
			</section>
		);
	}
	return (
		<>
			<section className="projects-summary-grid">
				<SummaryTile
					icon={<Shield className="icon" />}
					label="Risk"
					value={selectedExport.scanSummary.riskBand}
				/>
				<SummaryTile
					icon={<CheckCircle2 className="icon" />}
					label="Evidence"
					value={selectedExport.scanSummary.evidenceQuality}
				/>
				<SummaryTile
					icon={<BarChart3 className="icon" />}
					label="Findings"
					value={selectedExport.scan.findingCount}
				/>
				<SummaryTile
					icon={<Braces className="icon" />}
					label="Graph"
					value={`${selectedExport.graph.nodes.length}/${selectedExport.graph.edges.length}`}
				/>
			</section>

			<section className="projects-band">
				<div className="projects-section-head">
					<div>
						<h2>Summary</h2>
						<p>
							scanRunId {selectedExport.scan.id} / generated{" "}
							{formatDateTime(selectedExport.generatedAt)}
						</p>
					</div>
					<div className="project-section-actions">
						<Button
							type="button"
							variant="secondary"
							onClick={onRefreshAnalysis}
							disabled={refreshing}
						>
							<RefreshCw className="icon" />
							{refreshing ? "Refreshing…" : "Refresh Analysis"}
						</Button>
						<Link
							to="/scans"
							search={{
								projectId: project.id,
								scanRunId: selectedScanRunId ?? undefined,
							}}
							className="project-open-link"
						>
							Open Scan Workspace
							<ChevronRight className="icon" />
						</Link>
					</div>
				</div>
				<div className="project-metric-grid compact">
					<Metric
						label="Selection"
						value={view.selection.isLatest ? "Latest" : "Historical"}
					/>
					<Metric label="Profile" value={selectedExport.scan.profile} />
					<Metric label="Review" value={selectedExport.scan.reviewStatus} />
					<Metric label="Tools" value={selectedExport.scan.toolRunCount} />
					<Metric label="Artifacts" value={selectedExport.scan.artifactCount} />
				</div>
				<DegradedReasons reasons={view.degradedReasons} />
			</section>

			<ReadinessStrip readiness={view.readiness} />
			<nav
				className="project-inner-nav"
				aria-label="Project Intelligence sections"
			>
				{[
					["overview", "Overview"],
					["structure", "Structure"],
					["risk-evidence", "Risk & Evidence"],
					["agent-context", "Agent Context"],
					["ontology-handoff", "Ontology Handoff"],
					["source-health", "Source Health"],
				].map(([id, label]) => (
					<a key={id} href={`#${id}`}>
						{label}
					</a>
				))}
			</nav>

			<div id="risk-evidence">
				<FileRiskSection entries={selectedExport.fileRiskIndex} />
			</div>
			<EvidenceGraphSection graph={selectedExport.graph} />
			<div id="structure">
				<StructureExplorer
					structure={structure}
					projectStructureSummary={projectStructureSummary}
					exportPayload={selectedExport}
				/>
			</div>
			<div id="agent-context">
				<AgentBundleSection
					scanRunId={selectedScanRunId}
					agentMode={agentMode}
					agentPreview={agentPreview}
					agentLoading={agentLoading}
					onAgentModeChange={onAgentModeChange}
					onLoadAgentPreview={onLoadAgentPreview}
				/>
			</div>
			<div id="ontology-handoff">
				<OntologyHandoffSection
					handoff={ontologyHandoff}
					manifest={view.manifest}
				/>
			</div>
			<div id="source-health">
				<SourceHealthSection
					project={project}
					exportPayload={selectedExport}
					view={view}
				/>
			</div>
			<section className="projects-band">
				<div className="projects-section-head">
					<div>
						<h2>Scan Runs</h2>
						<p>Static IntelligenceからScansへ移動するための参照履歴です。</p>
					</div>
				</div>
				<ScanRunList projectId={project.id} scanRuns={scanRuns} />
			</section>
		</>
	);
}

function ReadinessStrip({
	readiness,
}: {
	readiness: ProjectIntelligenceView["readiness"];
}) {
	const items = [
		["Scan Evidence", readiness.fileRiskIndex],
		["Code Structure", readiness.codeStructure],
		["Evidence Graph", readiness.evidenceGraph],
		["Semantic Index", readiness.semanticIndex],
		["Agent Bundle", readiness.agentBundle],
		["Ontology Handoff", readiness.ontologyHandoff],
	] as const;
	return (
		<section
			className="readiness-strip"
			aria-label="Static Intelligence readiness"
		>
			{items.map(([label, value]) => (
				<div key={label} className={`readiness-item status-${value.status}`}>
					<span>{label}</span>
					<strong>{readinessPresentation(value).label}</strong>
					<small>
						{value.reasonCodes.join(", ") ||
							readinessPresentation(value).nextAction ||
							"ready"}
					</small>
				</div>
			))}
		</section>
	);
}

function StructureExplorer({
	structure,
	projectStructureSummary,
	exportPayload,
}: {
	structure: ProjectStructureListResponse | null;
	projectStructureSummary: ProjectStructureSummaryResponse | null;
	exportPayload: StaticIntelligenceExportV1;
}) {
	const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
	const selectedModule =
		structure?.modules.find((module) => module.id === selectedModuleId) ??
		structure?.modules[0] ??
		null;
	if (!structure || structure.status === "missing")
		return <CodeStructureSection exportPayload={exportPayload} />;
	const files = selectedModule
		? structure.items.filter(
				(file) =>
					file.path === selectedModule.pathPrefix ||
					file.path.startsWith(`${selectedModule.pathPrefix}/`),
			)
		: structure.items;
	return (
		<section className="projects-band">
			<div className="projects-section-head">
				<div>
					<h2>Structure Explorer</h2>
					<p>
						{structure.total ?? structure.items.length} persisted files ·
						generation {structure.generationId}
					</p>
					{projectStructureSummary?.status === "missing" ? (
						<p className="project-structure-legacy">
							Legacy structure snapshot (v1 compatibility view)
						</p>
					) : null}
				</div>
				<StatusBadge status={structure.status} />
			</div>
			{projectStructureSummary?.summary && projectStructureSummary.coverage ? (
				<p className="project-structure-coverage">
					v2 coverage: {projectStructureSummary.summary.analyzedFileCount}/
					{projectStructureSummary.coverage.includedFileCount} analyzed ·{" "}
					{projectStructureSummary.summary.resolvedReferenceCount} references
					resolved · {projectStructureSummary.coverage.unsupportedFileCount}{" "}
					unsupported (inventory only) ·{" "}
					{projectStructureSummary.summary.resourceFileCount} resources
					{projectStructureSummary.readiness?.resolution.status === "degraded"
						? ` · resolver: ${projectStructureSummary.readiness.resolution.reasonCodes.join(", ")}`
						: " · resolver ready"}
				</p>
			) : null}
			<div className="structure-explorer">
				<aside className="module-list">
					{structure.modules.map((module) => (
						<button
							type="button"
							key={module.id}
							className={selectedModule?.id === module.id ? "selected" : ""}
							onClick={() => setSelectedModuleId(module.id)}
						>
							<strong>{module.label}</strong>
							<span>{module.pathPrefix}</span>
							<small>
								{module.fileCount} files · {module.risk.findingCount} findings ·{" "}
								{module.risk.maxSeverity}
							</small>
						</button>
					))}
				</aside>
				<div className="module-detail">
					{selectedModule ? (
						<>
							<h3>{selectedModule.pathPrefix}</h3>
							<p>
								Deterministic module candidate · confidence{" "}
								{selectedModule.confidence.toFixed(2)}
							</p>
							<div className="project-chip-cloud">
								{selectedModule.roleTags.map((tag) => (
									<span className="project-chip" key={tag}>
										{tag}
									</span>
								))}
							</div>
							<dl>
								<dt>Reasons</dt>
								<dd>{selectedModule.reasons.join(" · ")}</dd>
								<dt>Entrypoints</dt>
								<dd>{selectedModule.entrypointFiles.join(", ") || "none"}</dd>
								<dt>Imports modules</dt>
								<dd>
									{selectedModule.internalDependencies.join(", ") || "none"}
								</dd>
								<dt>Packages</dt>
								<dd>
									{selectedModule.packageDependencies.join(", ") || "none"}
								</dd>
								<dt>Exports</dt>
								<dd>{selectedModule.exportedSymbols.join(", ") || "none"}</dd>
							</dl>
						</>
					) : (
						<p>No module candidates.</p>
					)}
					<div className="project-table-wrap">
						<table className="project-table">
							<thead>
								<tr>
									<th>File</th>
									<th>Tags</th>
									<th>Parse</th>
									<th>Imports</th>
									<th>Exports</th>
									<th>Risk</th>
								</tr>
							</thead>
							<tbody>
								{files.map((file) => (
									<tr key={file.path}>
										<td>{file.path}</td>
										<td>{file.tags.join(", ")}</td>
										<td>{file.parseStatus}</td>
										<td>{file.importCount}</td>
										<td>{file.exportCount}</td>
										<td>{file.risk?.maxSeverity ?? "none"}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</section>
	);
}

function OntologyHandoffSection({
	handoff,
	manifest,
}: {
	handoff: StaticIntelligenceOntologyHandoff | null;
	manifest: ProjectIntelligenceView["manifest"];
}) {
	if (!handoff)
		return (
			<section className="projects-band">
				<div className="projects-section-head">
					<div>
						<h2>External Agent Readiness</h2>
						<p>
							Persisted generation is missing. vulnWorkbench cannot determine
							whether any external consumer is connected.
						</p>
					</div>
					<StatusBadge status="missing" />
				</div>
			</section>
		);
	const pullCommands = [
		...(manifest?.availableBundles
			.filter((bundle) =>
				[
					"static_intelligence_export",
					"code_structure_snapshot",
					"agent_query",
				].includes(bundle.kind),
			)
			.map((bundle) => formatCommandTokens(bundle.command)) ?? []),
		`vuln_get_knowledge_source_manifest { scanRunId: ${handoff.scanRunId}, generationId: ${handoff.generationId} }`,
	];
	return (
		<section className="projects-band">
			<div className="projects-section-head">
				<div>
					<h2>External Agent Readiness</h2>
					<p>
						Evidence-backed module candidates for downstream mapping. These are
						not canonical Ontology nodes.
					</p>
				</div>
				<StatusBadge status={handoff.status} />
			</div>
			<div className="project-metric-grid compact">
				<Metric label="Generation" value={handoff.generationId} />
				<Metric label="Modules" value={handoff.modules.length} />
				<Metric label="Snapshot" value={handoff.snapshotRef} />
				<Metric label="Export Hash" value={handoff.exportHash.slice(0, 16)} />
			</div>
			<p className="consumer-boundary">
				vulnWorkbench does not own canonical ontology or task compilation.
				Consumer boundary: {handoff.consumerBoundary.consumer}. Persisted data
				is ready to pull; external connection and adoption are unknown.
			</p>
			<div className="module-handoff-list">
				{handoff.modules.map((module) => (
					<article key={module.id}>
						<strong>{module.pathPrefix}</strong>
						<span>
							{module.fileCount} files · {module.risk.findingCount} findings
						</span>
						<small>{module.reasons.join(" · ")}</small>
					</article>
				))}
			</div>
			<div className="command-list">
				{pullCommands.map((command) => (
					<button
						type="button"
						key={command}
						onClick={() => void navigator.clipboard?.writeText(command)}
					>
						<Copy className="icon" />
						<code>{command}</code>
					</button>
				))}
			</div>
			<DegradedReasons reasons={handoff.degradedReasons} />
		</section>
	);
}

function FileRiskSection({ entries }: { entries: FileRiskIndexEntry[] }) {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	useEffect(() => {
		if (selectedPath && !entries.some((entry) => entry.path === selectedPath)) {
			setSelectedPath(null);
		}
	}, [entries, selectedPath]);
	const sorted = [...entries].sort(
		(a, b) =>
			severityOrder[a.maxSeverity] - severityOrder[b.maxSeverity] ||
			b.findingCount - a.findingCount ||
			a.path.localeCompare(b.path),
	);
	return (
		<section className="projects-band">
			<div className="projects-section-head">
				<div>
					<h2>Files</h2>
					<p>{entries.length} file risk entries</p>
				</div>
			</div>
			<div className="project-table-wrap">
				<table className="project-table">
					<thead>
						<tr>
							<th>Path</th>
							<th>Severity</th>
							<th>Findings</th>
							<th>Evidence</th>
							<th>Scanners</th>
						</tr>
					</thead>
					<tbody>
						{sorted.slice(0, 40).map((entry) => (
							<tr
								key={entry.path}
								onClick={() => setSelectedPath(entry.path)}
								className={selectedPath === entry.path ? "selected" : ""}
							>
								<td>{entry.path}</td>
								<td>
									<span
										className={`project-chip severity-${entry.maxSeverity}`}
									>
										{entry.maxSeverity}
									</span>
								</td>
								<td>{entry.findingCount}</td>
								<td>{entry.evidenceQuality}</td>
								<td>{entry.scanners.join(", ") || "none"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{selectedPath ? (
				<RiskDetail
					entry={sorted.find((entry) => entry.path === selectedPath) ?? null}
				/>
			) : null}
		</section>
	);
}

function RiskDetail({ entry }: { entry: FileRiskIndexEntry | null }) {
	if (!entry) return null;
	return (
		<aside className="project-detail-panel">
			<h3>{entry.path}</h3>
			<dl>
				<dt>Rules</dt>
				<dd>{entry.ruleIds.join(", ") || "none"}</dd>
				<dt>Findings</dt>
				<dd>{entry.findingIds.join(", ") || "none"}</dd>
				<dt>Evidence</dt>
				<dd>{entry.evidenceRefs.join(", ") || "none"}</dd>
				<dt>Artifacts</dt>
				<dd>{entry.artifactRefs.join(", ") || "none"}</dd>
				<dt>Verification</dt>
				<dd>{entry.verificationRefs.join(", ") || "none"}</dd>
			</dl>
		</aside>
	);
}

function EvidenceGraphSection({ graph }: { graph: DiagnosticEvidenceGraph }) {
	const { nodeCounts, edgeCounts } = countGraphKinds(graph);
	const [selectedNodeId, setSelectedNodeId] = useState(
		graph.nodes[0]?.id ?? "",
	);
	useEffect(() => {
		if (!graph.nodes.some((node) => node.id === selectedNodeId)) {
			setSelectedNodeId(graph.nodes[0]?.id ?? "");
		}
	}, [graph.nodes, selectedNodeId]);
	const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
	const incoming = graph.edges.filter((edge) => edge.to === selectedNodeId);
	const outgoing = graph.edges.filter((edge) => edge.from === selectedNodeId);
	return (
		<section className="projects-band">
			<div className="projects-section-head">
				<div>
					<h2>Evidence Graph</h2>
					<p>
						{graph.nodes.length} nodes / {graph.edges.length} edges
					</p>
				</div>
			</div>
			<div className="project-chip-cloud">
				{Object.entries(nodeCounts).map(([kind, count]) => (
					<span key={kind} className="project-chip">
						{kind}: {count}
					</span>
				))}
				{Object.entries(edgeCounts).map(([kind, count]) => (
					<span key={kind} className="project-chip">
						{kind}: {count}
					</span>
				))}
			</div>
			<div className="evidence-adjacency">
				<SelectInput
					value={selectedNodeId}
					onChange={(event) => setSelectedNodeId(event.target.value)}
				>
					{graph.nodes.map((node) => (
						<option value={node.id} key={node.id}>
							{node.kind}: {node.label}
						</option>
					))}
				</SelectInput>
				{selectedNode ? (
					<p>
						<strong>{selectedNode.label}</strong> · {selectedNode.kind}
					</p>
				) : null}
				<div className="project-metric-grid compact">
					<Metric label="Incoming" value={incoming.length} />
					<Metric label="Outgoing" value={outgoing.length} />
				</div>
				<ul>
					{[...incoming, ...outgoing].map((edge) => (
						<li key={edge.id}>
							<code>{edge.kind}</code> {edge.from} → {edge.to}
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

function CodeStructureSection({
	exportPayload,
}: {
	exportPayload: StaticIntelligenceExportV1;
}) {
	const code = exportPayload.codeStructure;
	return (
		<section className="projects-band">
			<div className="projects-section-head">
				<div>
					<h2>Code Structure</h2>
					<p>
						{code
							? `snapshot ${code.snapshotRef ?? "without snapshotRef"}`
							: "No code structure snapshot is attached to this export."}
					</p>
				</div>
				<StatusBadge status={code?.status ?? "missing"} />
			</div>
			{code?.summary ? (
				<div className="project-metric-grid compact">
					<Metric label="Files" value={code.summary.fileCount} />
					<Metric label="Parsed" value={code.summary.parsedFileCount} />
					<Metric label="Imports" value={code.summary.importEdgeCount} />
					<Metric
						label="Packages"
						value={code.summary.packageDependencyCount}
					/>
				</div>
			) : null}
			<DegradedReasons
				reasons={
					code?.degradedReasons.length
						? code.degradedReasons
						: code
							? []
							: [
									"code structure snapshot missing from static intelligence export",
								]
				}
			/>
		</section>
	);
}

function AgentBundleSection({
	scanRunId,
	agentMode,
	agentPreview,
	agentLoading,
	onAgentModeChange,
	onLoadAgentPreview,
}: {
	scanRunId: string | null;
	agentMode: ScanIntelligenceAgentMode;
	agentPreview: Awaited<
		ReturnType<typeof fetchScanIntelligenceAgentQuery>
	> | null;
	agentLoading: boolean;
	onAgentModeChange: (mode: ScanIntelligenceAgentMode) => void;
	onLoadAgentPreview: () => void;
}) {
	return (
		<section className="projects-band">
			<div className="projects-section-head">
				<div>
					<h2>Agent Bundle</h2>
					<p>外部エージェントが読む候補コンテキストのプレビューです。</p>
				</div>
				<div className="project-section-actions">
					<SelectInput
						value={agentMode}
						onChange={(event) =>
							onAgentModeChange(event.target.value as ScanIntelligenceAgentMode)
						}
						disabled={!scanRunId}
					>
						{agentModes.map((mode) => (
							<option key={mode.id} value={mode.id}>
								{mode.label}
							</option>
						))}
					</SelectInput>
					<Button
						type="button"
						variant="secondary"
						onClick={onLoadAgentPreview}
						disabled={!scanRunId || agentLoading}
					>
						<Network className="icon" />
						Preview
					</Button>
				</div>
			</div>
			<div className="agent-preview">
				{agentPreview ? (
					<>
						<strong>{agentPreview.summary.title}</strong>
						<p>{agentPreview.summary.body}</p>
						<div className="project-metric-grid compact">
							<Metric
								label="Query Kind"
								value={agentModeToQueryKind[agentMode]}
							/>
							<Metric label="Items" value={agentPreview.results.length} />
							<Metric
								label="Source Refs"
								value={agentPreview.refs.sourceRefs.length}
							/>
						</div>
						<div className="agent-result-list">
							{agentPreview.results.map((item) => (
								<article key={item.id}>
									<strong>{item.title}</strong>
									<p>{item.kind} · candidate only</p>
									<small>
										{[
											...item.findingIds,
											...item.evidenceRefs,
											...item.fileRefs,
										].join(" · ") || "No related refs"}
									</small>
								</article>
							))}
						</div>
						<div className="project-chip-cloud">
							{agentPreview.refs.sourceRefs.map((ref) => (
								<span className="project-chip" key={ref}>
									{ref}
								</span>
							))}
						</div>
						<DegradedReasons reasons={agentPreview.degradedReasons} />
					</>
				) : (
					<p>Select a mode and preview the read-only agent bundle.</p>
				)}
			</div>
		</section>
	);
}

function SourceHealthSection({
	project,
	exportPayload,
	view,
}: {
	project: ProjectIntelligenceProject;
	exportPayload: StaticIntelligenceExportV1;
	view: ProjectIntelligenceView;
}) {
	const commands =
		view.manifest?.availableBundles.map((bundle) => ({
			kind: bundle.kind,
			command: formatCommandTokens(bundle.command),
		})) ?? [];
	return (
		<section className="projects-band">
			<div className="projects-section-head">
				<div>
					<h2>Source Health</h2>
					<p>
						projectId {project.id} / scanRunId {exportPayload.scan.id}
					</p>
				</div>
			</div>
			{view.generation ? (
				<div className="project-metric-grid compact">
					<Metric label="Status" value={view.generation.status} />
					<Metric label="Generation" value={view.generation.generationId} />
					<Metric
						label="Generated"
						value={formatDateTime(view.generation.generatedAt)}
					/>
					<Metric
						label="Source Tree"
						value={view.generation.sourceTreeHash.slice(0, 16)}
					/>
					<Metric
						label="Source State"
						value={view.generation.sourceStateHash.slice(0, 16)}
					/>
					<Metric
						label="Snapshot"
						value={view.generation.snapshotRef ?? "missing"}
					/>
					<Metric
						label="Export"
						value={view.generation.exportHash.slice(0, 16)}
					/>
					<Metric label="Schema" value="static-intelligence-export-v1" />
					<Metric
						label="Semantic Index"
						value={view.readiness.semanticIndex.status}
					/>
					<Metric
						label="Manifest Schema"
						value={view.manifest ? "validated" : "missing"}
					/>
					<Metric
						label="Manifest"
						value={view.manifest?.source.contentHash.slice(0, 16) ?? "missing"}
					/>
				</div>
			) : null}
			<div className="command-list">
				{commands.map(({ kind, command }) => (
					<button
						type="button"
						key={kind}
						onClick={() => void navigator.clipboard?.writeText(command)}
					>
						<Copy className="icon" />
						<code>
							{kind}: {command}
						</code>
					</button>
				))}
			</div>
		</section>
	);
}

function ScanRunList({
	projectId,
	scanRuns,
}: {
	projectId: string;
	scanRuns: ScanRun[];
}) {
	if (scanRuns.length === 0) {
		return (
			<div className="projects-empty compact">
				No scan runs for this project.
			</div>
		);
	}
	return (
		<div className="scan-run-strip">
			{scanRuns.slice(0, 8).map((run) => (
				<Link
					to="/projects/$projectId/intelligence"
					search={{ scanRunId: run.id }}
					params={{ projectId }}
					key={run.id}
					className="scan-run-chip"
				>
					<span>{run.profile}</span>
					<strong>{formatScanOutcome(run.status)}</strong>
					<small>{formatDateTime(run.createdAt)}</small>
				</Link>
			))}
		</div>
	);
}

function SummaryTile({
	icon,
	label,
	value,
}: {
	icon: ReactNode;
	label: string;
	value: string | number;
}) {
	return (
		<div className="project-summary-tile">
			{icon}
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string | number }) {
	return (
		<div className="project-metric">
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	return <span className={`project-status status-${status}`}>{status}</span>;
}

function DegradedReasons({ reasons }: { reasons: string[] }) {
	if (reasons.length === 0) return null;
	return (
		<div className="project-degraded">
			<AlertTriangle className="icon" />
			<div>
				<strong>Degraded reasons</strong>
				<ul>
					{reasons.map((reason) => (
						<li key={reason}>{reason}</li>
					))}
				</ul>
			</div>
		</div>
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
