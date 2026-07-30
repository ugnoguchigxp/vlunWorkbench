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
	FileRiskSection,
	OntologyHandoffSection,
	StructureExplorer,
} from "./project-structure-panels";
import {
	AgentBundleSection,
	CodeStructureSection,
	DegradedReasons,
	EvidenceGraphSection,
	Metric,
	ScanRunList,
	SourceHealthSection,
	SummaryTile,
} from "./project-detail-sections";

export function IntelligenceView({
	project,
	view,
	scanRuns,
	selectedScanRunId,
	selectedExport,
	structure,
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

export function ReadinessStrip({
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
