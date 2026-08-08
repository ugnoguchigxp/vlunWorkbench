import { Link } from "@tanstack/react-router";
import { ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type {
	fetchScanIntelligenceAgentQuery,
	ProjectIntelligenceProject,
	ProjectIntelligenceView,
	ScanIntelligenceAgentMode,
	ScanRun,
} from "../../api";
import { Button } from "../../ui";
import { formatDateTime } from "../scans/scans-utils";
import { IntelligenceGuidedPanel } from "./project-intelligence-guided-panel";
import { IntelligenceInvestigationPanel } from "./project-intelligence-investigation-panel";
import { IntelligenceLandscapePanel } from "./project-intelligence-landscape-panel";
import { IntelligencePriorityPanel } from "./project-intelligence-priority-panel";
import type { IntelligenceViewId } from "./project-intelligence-tab-model";
import { IntelligenceTabs } from "./project-intelligence-tabs";
import { useIntelligenceWorkspaceData } from "./use-intelligence-workspace-data";

export function IntelligenceView({
	project,
	view,
	scanRuns,
	selectedScanRunId,
	selectedExport,
	activeView,
	focusPath,
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
	activeView: IntelligenceViewId;
	focusPath: string | null;
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
	const [analysisDetailsOpen, setAnalysisDetailsOpen] = useState(false);
	const data = useIntelligenceWorkspaceData({
		projectId: project.id,
		scanRunId: selectedScanRunId,
		generationId: view?.generation?.generationId ?? null,
		activeView,
		analysisDetailsOpen,
	});

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

	const scanRunId = selectedScanRunId ?? selectedExport.scan.id;
	return (
		<div className="intelligence-workspace">
			<section className="intelligence-context-bar" aria-busy={refreshing}>
				<div>
					<span>Intelligence workspace</span>
					<strong>{selectedExport.scan.profile}</strong>
					<small>
						{view.selection.isLatest ? "最新の分析" : "過去の分析"} · generated{" "}
						{formatDateTime(selectedExport.generatedAt)}
					</small>
				</div>
				<div className="project-section-actions">
					<Button
						type="button"
						variant="secondary"
						onClick={onRefreshAnalysis}
						disabled={refreshing}
					>
						<RefreshCw className={`icon${refreshing ? " spinning" : ""}`} />
						{refreshing ? "更新中…" : "分析を更新"}
					</Button>
					<Link
						to="/scans"
						search={{ projectId: project.id, scanRunId }}
						className="project-open-link"
					>
						Scan Workspace
						<ChevronRight className="icon" />
					</Link>
				</div>
			</section>

			<IntelligenceTabs
				projectId={project.id}
				scanRunId={scanRunId}
				activeView={activeView}
			/>

			{activeView === "priority" ? (
				<IntelligencePriorityPanel
					project={project}
					view={view}
					scanRuns={scanRuns}
					selectedScanRunId={scanRunId}
					selectedExport={selectedExport}
					ontologyHandoff={data.ontologyHandoff}
					ontologyStatus={data.ontologyStatus}
					ontologyError={data.ontologyError}
					onAnalysisDetailsOpenChange={setAnalysisDetailsOpen}
					onReloadOntology={() => void data.reloadOntology()}
					agentMode={agentMode}
					agentPreview={agentPreview}
					agentLoading={agentLoading}
					onAgentModeChange={onAgentModeChange}
					onLoadAgentPreview={onLoadAgentPreview}
				/>
			) : null}

			{activeView === "investigate" ? (
				<IntelligenceInvestigationPanel
					projectId={project.id}
					scanRunId={scanRunId}
					exportPayload={selectedExport}
					focusPath={focusPath}
					findings={data.findings}
					findingsStatus={data.findingsStatus}
					findingsError={data.findingsError}
					onReloadFindings={() => void data.reloadFindings()}
					details={data.details}
					detailStatus={data.detailStatus}
					detailErrors={data.detailErrors}
					onLoadFinding={data.loadFindingDetail}
				/>
			) : null}

			{activeView === "landscape" ? (
				<IntelligenceLandscapePanel
					projectId={project.id}
					scanRunId={scanRunId}
					exportPayload={selectedExport}
					structure={data.structure}
					structureStatus={data.structureStatus}
					structureError={data.structureError}
					onReloadStructure={() => void data.reloadStructure()}
					landscapeResult={data.landscape}
					landscapeStatus={data.landscapeStatus}
					landscapeError={data.landscapeError}
					onReloadLandscape={() => void data.reloadLandscape()}
				/>
			) : null}

			{activeView === "guided" ? (
				<IntelligenceGuidedPanel
					projectId={project.id}
					scanRunId={scanRunId}
					exportPayload={selectedExport}
					findings={data.findings}
					findingsStatus={data.findingsStatus}
					findingsError={data.findingsError}
					onReloadFindings={() => void data.reloadFindings()}
					details={data.details}
					detailStatus={data.detailStatus}
					detailErrors={data.detailErrors}
					onLoadFinding={data.loadFindingDetail}
					onSaveDecision={data.saveFindingDecision}
				/>
			) : null}
		</div>
	);
}
