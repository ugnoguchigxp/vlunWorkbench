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
	fetchProjectIntelligenceOverview,
	fetchProjects,
	fetchScanIntelligenceExport,
	fetchScanIntelligenceAgentQuery,
	fetchScans,
	type Project,
	type ProjectIntelligenceOverview,
	type ScanIntelligenceAgentMode,
	type ScanRun,
} from "../../api";
import { Button, SelectInput, TextInput } from "../../ui";
import {
	buildProjectCardSummary,
	countGraphKinds,
} from "./project-intelligence-view-model";
import { formatScanOutcome } from "../scans/scan-profile-display";
import { formatDateTime } from "../scans/scans-utils";

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
	const [projects, setProjects] = useState<Project[]>([]);
	const [overviewByProjectId, setOverviewByProjectId] = useState<
		Record<string, ProjectIntelligenceOverview | null>
	>({});
	const [selectedOverview, setSelectedOverview] =
		useState<ProjectIntelligenceOverview | null>(null);
	const [selectedScanExport, setSelectedScanExport] =
		useState<StaticIntelligenceExportV1 | null>(null);
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [loading, setLoading] = useState(false);
	const [registerOpen, setRegisterOpen] = useState(false);
	const [projectName, setProjectName] = useState("");
	const [projectPath, setProjectPath] = useState("");
	const [defaultBranch, setDefaultBranch] = useState("main");
	const [browseLoading, setBrowseLoading] = useState(false);
	const [agentMode, setAgentMode] =
		useState<ScanIntelligenceAgentMode>("overview");
	const [agentPreview, setAgentPreview] = useState<{
		title: string;
		body: string;
		resultCount: number;
		sourceRefCount: number;
		degradedReasons: string[];
	} | null>(null);
	const [agentLoading, setAgentLoading] = useState(false);

	const selectedProject = useMemo(
		() =>
			routeState.projectId
				? (projects.find((item) => item.id === routeState.projectId) ?? null)
				: null,
		[projects, routeState.projectId],
	);

	const selectedScanRunId =
		routeState.scanRunId ?? selectedOverview?.latestScan?.id ?? null;
	const selectedExport =
		selectedScanExport ?? selectedOverview?.latestExport ?? null;

	const loadProjects = useCallback(async () => {
		setLoading(true);
		try {
			const list = await fetchProjects();
			setProjects(list);
			const overviewEntries = await Promise.all(
				list.map(async (project) => {
					try {
						return [
							project.id,
							await fetchProjectIntelligenceOverview(project.id),
						] as const;
					} catch {
						return [project.id, null] as const;
					}
				}),
			);
			setOverviewByProjectId(Object.fromEntries(overviewEntries));
		} finally {
			setLoading(false);
		}
	}, []);

	const loadSelectedProject = useCallback(async () => {
		if (!routeState.projectId) {
			setSelectedOverview(null);
			setScanRuns([]);
			return;
		}
		setLoading(true);
		try {
			const [overview, scans] = await Promise.all([
				fetchProjectIntelligenceOverview(routeState.projectId),
				fetchScans(routeState.projectId),
			]);
			setSelectedOverview(overview);
			setScanRuns(scans);
			setOverviewByProjectId((current) => ({
				...current,
				[routeState.projectId as string]: overview,
			}));
		} finally {
			setLoading(false);
		}
	}, [routeState.projectId]);

	useEffect(() => {
		if (!active) return;
		void runWithBusy(loadProjects);
	}, [active, loadProjects, runWithBusy]);

	useEffect(() => {
		if (!active) return;
		void runWithBusy(loadSelectedProject);
	}, [active, loadSelectedProject, runWithBusy]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset preview when selected scan changes
	useEffect(() => {
		setAgentPreview(null);
		setAgentMode("overview");
	}, [selectedScanRunId]);

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setSelectedScanExport(null);
			return;
		}
		if (selectedScanRunId === selectedOverview?.latestExport?.scan.id) {
			setSelectedScanExport(null);
			return;
		}
		let cancelled = false;
		void runWithBusy(async () => {
			const exportPayload =
				await fetchScanIntelligenceExport(selectedScanRunId);
			if (!cancelled) setSelectedScanExport(exportPayload);
		});
		return () => {
			cancelled = true;
		};
	}, [
		active,
		runWithBusy,
		selectedOverview?.latestExport?.scan.id,
		selectedScanRunId,
	]);

	const handleRegister = async (event: FormEvent) => {
		event.preventDefault();
		await runWithBusy(async () => {
			const created = await createProject({
				name: projectName.trim(),
				repoPath: projectPath.trim(),
				defaultBranch: defaultBranch.trim() || "main",
			});
			setRegisterOpen(false);
			setProjectName("");
			setProjectPath("");
			setDefaultBranch("main");
			await loadProjects();
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
				if (!projectName.trim()) setProjectName(basename(result.path));
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
		if (!selectedScanRunId) return;
		setAgentLoading(true);
		try {
			const result = await fetchScanIntelligenceAgentQuery(selectedScanRunId, {
				mode: agentMode,
			});
			setAgentPreview({
				title: result.summary.title,
				body: result.summary.body,
				resultCount: result.results.length,
				sourceRefCount: result.refs.sourceRefs.length,
				degradedReasons: result.degradedReasons,
			});
		} catch (error) {
			setErrorText(
				error instanceof Error
					? error.message
					: "Failed to load agent bundle preview.",
			);
		} finally {
			setAgentLoading(false);
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
						onClick={() => void runWithBusy(loadProjects)}
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
					projectName={projectName}
					projectPath={projectPath}
					defaultBranch={defaultBranch}
					browseLoading={browseLoading}
					onProjectNameChange={setProjectName}
					onProjectPathChange={setProjectPath}
					onDefaultBranchChange={setDefaultBranch}
					onBrowse={() => void handleBrowse()}
					onSubmit={handleRegister}
				/>
			) : null}

			{routeState.projectId ? (
				<ProjectDetail
					project={selectedProject ?? selectedOverview?.project ?? null}
					overview={selectedOverview}
					scanRuns={scanRuns}
					activeTab={routeState.tab}
					selectedScanRunId={selectedScanRunId}
					selectedExport={selectedExport}
					agentMode={agentMode}
					agentPreview={agentPreview}
					agentLoading={agentLoading}
					onAgentModeChange={setAgentMode}
					onLoadAgentPreview={() => void handleLoadAgentPreview()}
				/>
			) : (
				<ProjectsList
					projects={projects}
					overviews={overviewByProjectId}
					loading={loading}
				/>
			)}
		</main>
	);
}

function ProjectRegistrationPanel({
	projectName,
	projectPath,
	defaultBranch,
	browseLoading,
	onProjectNameChange,
	onProjectPathChange,
	onDefaultBranchChange,
	onBrowse,
	onSubmit,
}: {
	projectName: string;
	projectPath: string;
	defaultBranch: string;
	browseLoading: boolean;
	onProjectNameChange: (value: string) => void;
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
				<label htmlFor="project-register-name">
					<span>Name</span>
					<TextInput
						id="project-register-name"
						value={projectName}
						onChange={(event) => onProjectNameChange(event.target.value)}
						required
					/>
				</label>
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
	overviews,
	loading,
}: {
	projects: Project[];
	overviews: Record<string, ProjectIntelligenceOverview | null>;
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
				const overview = overviews[project.id] ?? null;
				const summary = buildProjectCardSummary(overview);
				return (
					<article className="project-card" key={project.id}>
						<div className="project-card-head">
							<div>
								<h2>{project.name}</h2>
								<p>{shortPath(project.repoPath)}</p>
							</div>
							<StatusBadge
								status={overview?.availability.export ?? "missing"}
							/>
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
									{overview?.latestScan
										? formatScanOutcome(overview.latestScan.status)
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
	overview,
	scanRuns,
	activeTab,
	selectedScanRunId,
	selectedExport,
	agentMode,
	agentPreview,
	agentLoading,
	onAgentModeChange,
	onLoadAgentPreview,
}: {
	project: Project | null;
	overview: ProjectIntelligenceOverview | null;
	scanRuns: ScanRun[];
	activeTab: "list" | "overview" | "intelligence";
	selectedScanRunId: string | null;
	selectedExport: StaticIntelligenceExportV1 | null;
	agentMode: ScanIntelligenceAgentMode;
	agentPreview: {
		title: string;
		body: string;
		resultCount: number;
		sourceRefCount: number;
		degradedReasons: string[];
	} | null;
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
					<h2>{project.name}</h2>
					<p>{shortPath(project.repoPath)}</p>
				</div>
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
					<Link to="/scans">Scans</Link>
				</div>
			</section>

			{activeTab === "intelligence" ? (
				<IntelligenceView
					project={project}
					overview={overview}
					scanRuns={scanRuns}
					selectedScanRunId={selectedScanRunId}
					selectedExport={selectedExport}
					agentMode={agentMode}
					agentPreview={agentPreview}
					agentLoading={agentLoading}
					onAgentModeChange={onAgentModeChange}
					onLoadAgentPreview={onLoadAgentPreview}
				/>
			) : (
				<ProjectOverview
					project={project}
					overview={overview}
					scanRuns={scanRuns}
				/>
			)}
		</>
	);
}

function ProjectOverview({
	project,
	overview,
	scanRuns,
}: {
	project: Project;
	overview: ProjectIntelligenceOverview | null;
	scanRuns: ScanRun[];
}) {
	const exportPayload = overview?.latestExport ?? null;
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
						overview?.latestScan
							? formatScanOutcome(overview.latestScan.status)
							: "none"
					}
				/>
				<SummaryTile
					icon={<FileCode2 className="icon" />}
					label="Code Structure"
					value={overview?.availability.codeStructure ?? "missing"}
				/>
			</section>
			<section className="projects-band">
				<div className="projects-section-head">
					<div>
						<h2>Analysis Status</h2>
						<p>
							{overview?.latestScan
								? `Latest scan ${overview.latestScan.id}`
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
						<Link to="/scans" className="project-open-link">
							Open Scans
							<ChevronRight className="icon" />
						</Link>
					</div>
				</div>
				<DegradedReasons reasons={overview?.degradedReasons ?? []} />
				<ScanRunList projectId={project.id} scanRuns={scanRuns} />
			</section>
		</>
	);
}

function IntelligenceView({
	project,
	overview,
	scanRuns,
	selectedScanRunId,
	selectedExport,
	agentMode,
	agentPreview,
	agentLoading,
	onAgentModeChange,
	onLoadAgentPreview,
}: {
	project: Project;
	overview: ProjectIntelligenceOverview | null;
	scanRuns: ScanRun[];
	selectedScanRunId: string | null;
	selectedExport: StaticIntelligenceExportV1 | null;
	agentMode: ScanIntelligenceAgentMode;
	agentPreview: {
		title: string;
		body: string;
		resultCount: number;
		sourceRefCount: number;
		degradedReasons: string[];
	} | null;
	agentLoading: boolean;
	onAgentModeChange: (mode: ScanIntelligenceAgentMode) => void;
	onLoadAgentPreview: () => void;
}) {
	if (!selectedExport || !overview?.latestScan) {
		return (
			<section className="projects-empty">
				<h2>Static Intelligence is not available yet</h2>
				<p>Run or import a scan before inspecting project intelligence.</p>
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
						<Link to="/scans" className="project-open-link">
							Open Scan Workspace
							<ChevronRight className="icon" />
						</Link>
					</div>
				</div>
				<div className="project-metric-grid compact">
					<Metric label="Profile" value={selectedExport.scan.profile} />
					<Metric label="Review" value={selectedExport.scan.reviewStatus} />
					<Metric label="Tools" value={selectedExport.scan.toolRunCount} />
					<Metric label="Artifacts" value={selectedExport.scan.artifactCount} />
				</div>
				<DegradedReasons reasons={overview.degradedReasons} />
			</section>

			<FileRiskSection entries={selectedExport.fileRiskIndex} />
			<EvidenceGraphSection graph={selectedExport.graph} />
			<CodeStructureSection exportPayload={selectedExport} />
			<AgentBundleSection
				scanRunId={selectedScanRunId}
				agentMode={agentMode}
				agentPreview={agentPreview}
				agentLoading={agentLoading}
				onAgentModeChange={onAgentModeChange}
				onLoadAgentPreview={onLoadAgentPreview}
			/>
			<SourceHealthSection project={project} exportPayload={selectedExport} />
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

function FileRiskSection({ entries }: { entries: FileRiskIndexEntry[] }) {
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
							<tr key={entry.path}>
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
		</section>
	);
}

function EvidenceGraphSection({ graph }: { graph: DiagnosticEvidenceGraph }) {
	const { nodeCounts, edgeCounts } = countGraphKinds(graph);
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
	agentPreview: {
		title: string;
		body: string;
		resultCount: number;
		sourceRefCount: number;
		degradedReasons: string[];
	} | null;
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
						<strong>{agentPreview.title}</strong>
						<p>{agentPreview.body}</p>
						<div className="project-metric-grid compact">
							<Metric
								label="Query Kind"
								value={agentModeToQueryKind[agentMode]}
							/>
							<Metric label="Items" value={agentPreview.resultCount} />
							<Metric label="Source Refs" value={agentPreview.sourceRefCount} />
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
}: {
	project: Project;
	exportPayload: StaticIntelligenceExportV1;
}) {
	const commands = [
		`bun run intelligence:export -- --scan-run-id ${exportPayload.scan.id}`,
		`bun run intelligence:agent-query -- --scan-run-id ${exportPayload.scan.id} --query-kind project_overview`,
		`bun run intelligence:knowledge-source -- --scan-run-id ${exportPayload.scan.id}`,
		"bun run mcp:static-intelligence -- --list-tools",
	];
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
			<div className="command-list">
				{commands.map((command) => (
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
					search={{ scanRunId: run.id } as never}
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

function basename(path: string): string {
	return path.replace(/\/+$/, "").split("/").at(-1) || "Project";
}

function shortPath(path: string): string {
	const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
	return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : path;
}
