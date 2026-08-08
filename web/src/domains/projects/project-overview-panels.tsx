import { Link } from "@tanstack/react-router";
import {
	Activity,
	ChevronRight,
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
import {
	formatScanOutcome,
	getProfileDisplay,
} from "../scans/scan-profile-display";
import { formatDateTime } from "../scans/scans-utils";
import { Metric, StatusBadge } from "./project-detail-sections";
import { IntelligenceView } from "./project-intelligence-panels";
import { buildProjectCardSummary } from "./project-intelligence-view-model";
import {
	OverviewAction,
	OverviewStatus,
	RecentScanTable,
} from "./project-overview-components";
import { buildProjectOverviewPresentation } from "./project-overview-view-model";
import { SecurityCapabilityPanel } from "./project-security-capability-panel";

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
	loading,
	loadFailed,
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
	loading: boolean;
	loadFailed: boolean;
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
		if (loading) {
			return (
				<div className="projects-empty" role="status">
					プロジェクト情報を読み込んでいます…
				</div>
			);
		}
		return (
			<div className="projects-empty" role={loadFailed ? "alert" : undefined}>
				{loadFailed
					? "プロジェクト情報を読み込めませんでした。"
					: "プロジェクトが見つかりません。"}
			</div>
		);
	}
	return (
		<>
			<section className="projects-band project-detail-head">
				<div>
					<h1>{project.repositoryName}</h1>
					<p>
						{project.defaultBranch} ・ 最終更新{" "}
						{formatDateTime(project.updatedAt)}
					</p>
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
				<nav className="project-detail-actions" aria-label="プロジェクト">
					<Link
						to="/projects/$projectId"
						params={{ projectId: project.id }}
						className={activeTab === "overview" ? "active" : ""}
						aria-current={activeTab === "overview" ? "page" : undefined}
					>
						Overview
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
					<Link
						to="/projects/$projectId/intelligence"
						params={{ projectId: project.id }}
						search={{ scanRunId: undefined }}
						className={activeTab === "intelligence" ? "active" : ""}
						aria-current={activeTab === "intelligence" ? "page" : undefined}
					>
						Intelligence
					</Link>
				</nav>
			</section>

			{loading ? (
				<div className="projects-empty" role="status">
					プロジェクト情報を読み込んでいます…
				</div>
			) : !view ? (
				<div className="projects-empty" role={loadFailed ? "alert" : undefined}>
					プロジェクト情報を表示できません。
				</div>
			) : activeTab === "intelligence" ? (
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
				<ProjectOverview
					project={project}
					view={view}
					scanRuns={scanRuns}
					refreshing={refreshing}
					onRefreshAnalysis={onRefreshAnalysis}
				/>
			)}
		</>
	);
}

export function ProjectOverview({
	project,
	view,
	scanRuns,
	refreshing,
	onRefreshAnalysis,
}: {
	project: ProjectIntelligenceProject;
	view: ProjectIntelligenceView;
	scanRuns: ScanRun[];
	refreshing: boolean;
	onRefreshAnalysis: () => void;
}) {
	const presentation = buildProjectOverviewPresentation(view);
	const selectedScan = view.selectedScan ?? null;
	const scanTitle = selectedScan
		? getProfileDisplay(selectedScan.profile, selectedScan.profile, "").name
		: presentation.scan.title;
	const nextAction = presentation.intelligence.action
		? {
				title: presentation.intelligence.actionLabel ?? "Intelligenceを確認",
				description: presentation.intelligence.description,
			}
		: {
				title: presentation.scan.actionLabel,
				description: presentation.scan.description,
			};
	return (
		<>
			<section className="project-overview-heading">
				<h2>プロジェクト概要</h2>
				<p>スキャンの実行状態とIntelligenceの利用可否を分けて確認します。</p>
			</section>
			<div className="project-overview-status-grid">
				<section
					className="project-overview-domain-card"
					aria-labelledby="project-overview-scan-title"
				>
					<div className="project-overview-domain-head">
						<div className="project-overview-domain-name">
							<Activity className="icon" />
							<h2 id="project-overview-scan-title">スキャン</h2>
						</div>
						<OverviewStatus
							label={presentation.scan.status}
							tone={presentation.scan.tone}
						/>
					</div>
					<strong className="project-overview-domain-value">{scanTitle}</strong>
					{selectedScan ? (
						<small>
							{formatDateTime(
								selectedScan.completedAt ?? selectedScan.createdAt,
							)}
						</small>
					) : null}
					<p>{presentation.scan.description}</p>
					<OverviewAction
						action={presentation.scan.action}
						label={presentation.scan.actionLabel}
						projectId={project.id}
						scanRunId={selectedScan?.id ?? null}
						refreshing={refreshing}
						onRefreshAnalysis={onRefreshAnalysis}
					/>
				</section>

				<section
					className="project-overview-domain-card"
					aria-labelledby="project-overview-intelligence-title"
					aria-busy={refreshing}
				>
					<div className="project-overview-domain-head">
						<div className="project-overview-domain-name">
							<Shield className="icon" />
							<h2 id="project-overview-intelligence-title">Intelligence</h2>
						</div>
						<OverviewStatus
							label={presentation.intelligence.status}
							tone={presentation.intelligence.tone}
						/>
					</div>
					<strong className="project-overview-domain-value">
						{presentation.intelligence.title}
					</strong>
					{view.generation ? (
						<small>
							生成日時 {formatDateTime(view.generation.generatedAt)}
						</small>
					) : null}
					<p>{presentation.intelligence.description}</p>
					{presentation.intelligence.metrics.length > 0 ? (
						<div className="project-overview-metrics">
							{presentation.intelligence.metrics.map((metric) => (
								<div key={metric.label}>
									<span>{metric.label}</span>
									<strong>{metric.value}</strong>
								</div>
							))}
						</div>
					) : null}
					{presentation.intelligence.action &&
					presentation.intelligence.actionLabel ? (
						<OverviewAction
							action={presentation.intelligence.action}
							label={presentation.intelligence.actionLabel}
							projectId={project.id}
							scanRunId={selectedScan?.id ?? null}
							refreshing={refreshing}
							onRefreshAnalysis={onRefreshAnalysis}
						/>
					) : null}
				</section>
			</div>

			<div className="project-overview-content-grid">
				<section className="projects-band">
					<div className="projects-section-head project-overview-table-head">
						<div>
							<h2>最近のスキャン</h2>
							<p>このプロジェクトで最近実行されたスキャンです。</p>
						</div>
						<Link
							to="/scans"
							search={{ projectId: project.id, scanRunId: undefined }}
							className="project-open-link"
						>
							すべて表示
							<ChevronRight className="icon" />
						</Link>
					</div>
					<RecentScanTable projectId={project.id} scanRuns={scanRuns} />
				</section>

				<section className="projects-band project-overview-next-action">
					<div className="projects-section-head">
						<div>
							<h2>次のアクション</h2>
							<p>現在の状態から優先する操作です。</p>
						</div>
					</div>
					<div className="project-overview-action-item">
						<span aria-hidden="true">1</span>
						<div>
							<strong>{nextAction.title}</strong>
							<small>{nextAction.description}</small>
						</div>
					</div>
					{selectedScan && presentation.intelligence.action ? (
						<div className="project-overview-action-item">
							<span aria-hidden="true">2</span>
							<div>
								<strong>最新スキャンを確認</strong>
								<small>実行結果と保存された成果物を確認します。</small>
							</div>
						</div>
					) : null}
				</section>
			</div>
			<SecurityCapabilityPanel projectId={project.id} />
		</>
	);
}
