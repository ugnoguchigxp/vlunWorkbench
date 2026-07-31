import { Link } from "@tanstack/react-router";
import {
	Activity,
	CheckCircle2,
	ChevronRight,
	FileCode2,
	FolderOpen,
	GitBranch,
	Plus,
	Shield,
} from "lucide-react";
import type { FormEvent } from "react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceOntologyHandoff } from "../../../../shared/schemas/static-intelligence-module.schema";
import type {
	fetchScanIntelligenceAgentQuery,
	ProjectIntelligenceProject,
	ProjectIntelligenceSummary,
	ProjectIntelligenceView,
	ProjectStructureListResponse,
	ScanIntelligenceAgentMode,
	ScanRun,
} from "../../api";
import { Button, SelectInput, TextInput } from "../../ui";
import { formatScanOutcome } from "../scans/scan-profile-display";
import { formatDateTime } from "../scans/scans-utils";
import { buildProjectCardSummary } from "./project-intelligence-view-model";
import { SecurityCapabilityPanel } from "./project-security-capability-panel";

import { IntelligenceView } from "./project-intelligence-panels";
import {
	DegradedReasons,
	Metric,
	ScanRunList,
	StatusBadge,
	SummaryTile,
} from "./project-detail-sections";

export function ProjectRegistrationPanel({
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

export function ProjectsList({
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

export function ProjectDetail({
	project,
	view,
	scanRuns,
	activeTab,
	selectedScanRunId,
	selectedExport,
	structure,
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

export function ProjectOverview({
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
			<SecurityCapabilityPanel projectId={project.id} />
		</>
	);
}
