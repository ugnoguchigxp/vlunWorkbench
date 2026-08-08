import { Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	BarChart3,
	Braces,
	CheckCircle2,
	ChevronRight,
	CircleCheck,
	RotateCcw,
	Shield,
} from "lucide-react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceOntologyHandoff } from "../../../../shared/schemas/static-intelligence-module.schema";
import type {
	fetchScanIntelligenceAgentQuery,
	ProjectIntelligenceProject,
	ProjectIntelligenceView,
	ScanIntelligenceAgentMode,
	ScanRun,
} from "../../api";
import { Button } from "../../ui";
import {
	AgentBundleSection,
	DegradedReasons,
	ScanRunList,
	SourceHealthSection,
	SummaryTile,
} from "./project-detail-sections";
import { readinessPresentation } from "./project-intelligence-readiness";
import { buildPriorityPresentation } from "./project-intelligence-workspace-model";
import { OntologyHandoffSection } from "./project-structure-panels";

export function IntelligencePriorityPanel({
	project,
	view,
	scanRuns,
	selectedScanRunId,
	selectedExport,
	ontologyHandoff,
	ontologyStatus,
	ontologyError,
	onAnalysisDetailsOpenChange,
	onReloadOntology,
	agentMode,
	agentPreview,
	agentLoading,
	onAgentModeChange,
	onLoadAgentPreview,
}: {
	project: ProjectIntelligenceProject;
	view: ProjectIntelligenceView;
	scanRuns: ScanRun[];
	selectedScanRunId: string;
	selectedExport: StaticIntelligenceExportV1;
	ontologyHandoff: StaticIntelligenceOntologyHandoff | null;
	ontologyStatus: "idle" | "loading" | "loaded" | "failed";
	ontologyError: string | null;
	onAnalysisDetailsOpenChange: (open: boolean) => void;
	onReloadOntology: () => void;
	agentMode: ScanIntelligenceAgentMode;
	agentPreview: Awaited<
		ReturnType<typeof fetchScanIntelligenceAgentQuery>
	> | null;
	agentLoading: boolean;
	onAgentModeChange: (mode: ScanIntelligenceAgentMode) => void;
	onLoadAgentPreview: () => void;
}) {
	const presentation = buildPriorityPresentation(
		selectedExport,
		view.degradedReasons,
	);
	const structureCount =
		selectedExport.codeStructure?.summary?.fileCount ?? "未生成";
	return (
		<div className="intelligence-panel-stack">
			<section
				className={`intelligence-priority-callout tone-${presentation.tone}`}
				aria-labelledby="intelligence-priority-title"
			>
				{presentation.tone === "success" ? (
					<CircleCheck className="icon" />
				) : (
					<AlertTriangle className="icon" />
				)}
				<div>
					<span>現在の判断</span>
					<h2 id="intelligence-priority-title">{presentation.title}</h2>
					<p>{presentation.description}</p>
				</div>
				{presentation.topFiles[0] ? (
					<Link
						to="/projects/$projectId/intelligence"
						params={{ projectId: project.id }}
						search={{
							scanRunId: selectedScanRunId,
							intelligenceView: "investigate",
							focusPath: presentation.topFiles[0].path,
						}}
						className="project-open-link"
					>
						最優先を調査
						<ChevronRight className="icon" />
					</Link>
				) : null}
			</section>

			<section className="projects-summary-grid" aria-label="主要指標">
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
					label="Structure files"
					value={structureCount}
				/>
			</section>

			<section className="projects-band intelligence-priority-files">
				<div className="projects-section-head">
					<div>
						<h2>優先確認ファイル</h2>
						<p>SeverityとFinding件数から上位5件を表示しています。</p>
					</div>
					<Link
						to="/projects/$projectId/intelligence"
						params={{ projectId: project.id }}
						search={{
							scanRunId: selectedScanRunId,
							intelligenceView: "investigate",
						}}
						className="project-open-link"
					>
						すべて調査
						<ChevronRight className="icon" />
					</Link>
				</div>
				{presentation.topFiles.length > 0 ? (
					<div className="intelligence-priority-list">
						{presentation.topFiles.map((entry, index) => (
							<Link
								key={entry.path}
								to="/projects/$projectId/intelligence"
								params={{ projectId: project.id }}
								search={{
									scanRunId: selectedScanRunId,
									intelligenceView: "investigate",
									focusPath: entry.path,
								}}
							>
								<span className="intelligence-rank">{index + 1}</span>
								<span className="intelligence-priority-path">
									<strong>{entry.path}</strong>
									<small>
										{entry.scanners.join(", ") || "scanner不明"} · Evidence{" "}
										{entry.evidenceQuality}
									</small>
								</span>
								<span className={`project-chip severity-${entry.maxSeverity}`}>
									{entry.maxSeverity}
								</span>
								<strong>{entry.findingCount}件</strong>
								<ChevronRight className="icon" />
							</Link>
						))}
					</div>
				) : (
					<div className="projects-empty compact">
						現在の生成物にはファイルリスク情報がありません。
					</div>
				)}
			</section>

			<ReadinessStrip readiness={view.readiness} compact />
			<DegradedReasons reasons={view.degradedReasons} />

			<details
				className="projects-band intelligence-technical-details"
				onToggle={(event) =>
					onAnalysisDetailsOpenChange(event.currentTarget.open)
				}
			>
				<summary>
					<span>
						<strong>分析詳細</strong>
						<small>Agent、外部連携、ソース状態、スキャン履歴</small>
					</span>
					<ChevronRight className="icon" />
				</summary>
				<div className="intelligence-technical-stack">
					<AgentBundleSection
						scanRunId={selectedScanRunId}
						agentMode={agentMode}
						agentPreview={agentPreview}
						agentLoading={agentLoading}
						onAgentModeChange={onAgentModeChange}
						onLoadAgentPreview={onLoadAgentPreview}
					/>
					{ontologyStatus === "idle" || ontologyStatus === "loading" ? (
						<section className="projects-band" aria-busy="true" role="status">
							<div className="projects-section-head">
								<div>
									<h2>External Agent Readiness</h2>
									<p>Ontology handoffを読み込んでいます…</p>
								</div>
							</div>
						</section>
					) : ontologyStatus === "failed" ? (
						<section className="projects-band" role="alert">
							<div className="projects-section-head">
								<div>
									<h2>External Agent Readiness</h2>
									<p>{ontologyError}</p>
								</div>
								<Button
									type="button"
									variant="secondary"
									onClick={onReloadOntology}
								>
									<RotateCcw className="icon" /> 再試行
								</Button>
							</div>
						</section>
					) : (
						<OntologyHandoffSection
							handoff={ontologyHandoff}
							manifest={view.manifest}
						/>
					)}
					<SourceHealthSection
						project={project}
						exportPayload={selectedExport}
						view={view}
					/>
					<section className="projects-band">
						<div className="projects-section-head">
							<div>
								<h2>Scan Runs</h2>
								<p>過去の分析対象へ切り替えます。</p>
							</div>
						</div>
						<ScanRunList projectId={project.id} scanRuns={scanRuns} />
					</section>
				</div>
			</details>
		</div>
	);
}

export function ReadinessStrip({
	readiness,
	compact = false,
}: {
	readiness: ProjectIntelligenceView["readiness"];
	compact?: boolean;
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
			className={`readiness-strip${compact ? " compact" : ""}`}
			aria-label="Static Intelligence readiness"
		>
			{items.map(([label, value]) => (
				<div key={label} className={`readiness-item status-${value.status}`}>
					<span>{label}</span>
					<strong>{readinessPresentation(value).label}</strong>
					{!compact || value.status !== "available" ? (
						<small>
							{value.reasonCodes.join(", ") ||
								readinessPresentation(value).nextAction ||
								"ready"}
						</small>
					) : null}
				</div>
			))}
		</section>
	);
}
