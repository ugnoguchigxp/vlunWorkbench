import { RefreshCw } from "lucide-react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type {
	fetchScanIntelligenceAgentQuery,
	ProjectIntelligenceProject,
	ProjectIntelligenceView,
	ScanIntelligenceAgentMode,
} from "../../api";
import { Button } from "../../ui";
import { IntelligenceGenerationContext } from "./project-intelligence-generation-context";
import { IntelligenceHandoffPanel } from "./project-intelligence-handoff-panel";
import { IntelligenceModulePanel } from "./project-intelligence-module-panel";
import { IntelligenceOverviewPanel } from "./project-intelligence-overview-panel";
import { IntelligenceRelationshipPanel } from "./project-intelligence-relationship-panel";
import { resolveSelectedModule } from "./project-intelligence-structure-model";
import type { IntelligenceViewId } from "./project-intelligence-tab-model";
import { IntelligenceTabs } from "./project-intelligence-tabs";
import {
	useOntologyHandoff,
	useProjectStructureSummary,
} from "./use-intelligence-structure-data";

export function IntelligenceView({
	project,
	view,
	selectedScanRunId,
	selectedExport,
	activeView,
	focusPath,
	moduleId,
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
	selectedScanRunId: string | null;
	selectedExport: StaticIntelligenceExportV1 | null;
	activeView: IntelligenceViewId;
	focusPath: string | null;
	moduleId: string | null;
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
	const scanRunId = selectedScanRunId ?? selectedExport?.scan.id ?? "";
	const generationId = view?.generation?.generationId ?? "";
	const structure = useProjectStructureSummary({
		projectId: project.id,
		scanRunId: scanRunId || null,
		generationId: generationId || null,
	});
	const handoff = useOntologyHandoff({
		projectId: project.id,
		scanRunId,
		generationId,
		enabled: activeView === "handoff" && Boolean(scanRunId && generationId),
	});

	if (!selectedExport || !view?.selectedScan || !view.generation) {
		return (
			<section className="projects-empty">
				<h2>Intelligence generationはまだありません</h2>
				<p>
					{view?.readiness.export.reasonCodes.join(", ") ||
						"分析スナップショットを選び、構造情報を生成してください。"}
				</p>
				{view?.selectedScan ? (
					<Button
						type="button"
						variant="primary"
						onClick={onRefreshAnalysis}
						disabled={refreshing}
					>
						<RefreshCw className="icon" />
						{refreshing ? "生成中…" : "Intelligenceを生成"}
					</Button>
				) : null}
			</section>
		);
	}

	const selectedModule = resolveSelectedModule(
		structure.data?.modules ?? [],
		moduleId,
	);
	return (
		<div className="intelligence-workspace">
			<IntelligenceGenerationContext
				project={project}
				view={view}
				scanRunId={scanRunId}
				refreshing={refreshing}
				onRefresh={onRefreshAnalysis}
			/>
			<IntelligenceTabs
				projectId={project.id}
				scanRunId={scanRunId}
				activeView={activeView}
				moduleId={selectedModule?.id ?? moduleId}
			/>

			{activeView === "overview" ? (
				<IntelligenceOverviewPanel
					projectId={project.id}
					scanRunId={scanRunId}
					view={view}
					exportPayload={selectedExport}
					structure={structure.data}
					structureStatus={structure.status}
					structureError={structure.error}
					onReload={() => void structure.reload()}
				/>
			) : null}

			{activeView === "modules" ? (
				<IntelligenceModulePanel
					projectId={project.id}
					scanRunId={scanRunId}
					generationId={generationId}
					structure={structure.data}
					structureStatus={structure.status}
					structureError={structure.error}
					selectedModule={selectedModule}
					focusPath={focusPath}
					onReloadStructure={() => void structure.reload()}
				/>
			) : null}

			{activeView === "relationships" ? (
				<IntelligenceRelationshipPanel
					projectId={project.id}
					scanRunId={scanRunId}
					generationId={generationId}
					structure={structure.data}
					structureStatus={structure.status}
					structureError={structure.error}
					selectedModule={selectedModule}
					exportPayload={selectedExport}
					onReloadStructure={() => void structure.reload()}
				/>
			) : null}

			{activeView === "handoff" ? (
				<IntelligenceHandoffPanel
					projectId={project.id}
					scanRunId={scanRunId}
					view={view}
					handoff={handoff.data}
					status={handoff.status}
					error={handoff.error}
					onReload={() => void handoff.reload()}
					agentMode={agentMode}
					agentPreview={agentPreview}
					agentLoading={agentLoading}
					onAgentModeChange={onAgentModeChange}
					onLoadAgentPreview={onLoadAgentPreview}
				/>
			) : null}
		</div>
	);
}
