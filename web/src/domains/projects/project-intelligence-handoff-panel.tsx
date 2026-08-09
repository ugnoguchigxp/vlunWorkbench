import { Link } from "@tanstack/react-router";
import { Copy, RotateCcw } from "lucide-react";
import { useState } from "react";
import { formatCommandTokens } from "../../../../shared/format-command";
import type { StaticIntelligenceOntologyHandoff } from "../../../../shared/schemas/static-intelligence-module.schema";
import type {
	fetchScanIntelligenceAgentQuery,
	ProjectIntelligenceView,
	ScanIntelligenceAgentMode,
} from "../../api";
import { Button } from "../../ui";
import {
	AgentBundleSection,
	DegradedReasons,
	Metric,
	StatusBadge,
} from "./project-detail-sections";
import type { IntelligenceResourceStatus } from "./use-intelligence-structure-data";

export function IntelligenceHandoffPanel({
	projectId,
	scanRunId,
	view,
	handoff,
	status,
	error,
	onReload,
	agentMode,
	agentPreview,
	agentLoading,
	onAgentModeChange,
	onLoadAgentPreview,
}: {
	projectId: string;
	scanRunId: string;
	view: ProjectIntelligenceView;
	handoff: StaticIntelligenceOntologyHandoff | null;
	status: IntelligenceResourceStatus;
	error: string | null;
	onReload: () => void;
	agentMode: ScanIntelligenceAgentMode;
	agentPreview: Awaited<
		ReturnType<typeof fetchScanIntelligenceAgentQuery>
	> | null;
	agentLoading: boolean;
	onAgentModeChange: (mode: ScanIntelligenceAgentMode) => void;
	onLoadAgentPreview: () => void;
}) {
	const [copyMessage, setCopyMessage] = useState<string | null>(null);
	const pending = status === "idle" || status === "loading";
	const pullCommands = [
		...(view.manifest?.availableBundles
			.filter((bundle) =>
				[
					"static_intelligence_export",
					"project_structure_snapshot",
					"agent_query",
				].includes(bundle.kind),
			)
			.map((bundle) => formatCommandTokens(bundle.command)) ?? []),
		...(handoff
			? [
					`vuln_get_knowledge_source_manifest { scanRunId: ${handoff.scanRunId}, generationId: ${handoff.generationId} }`,
				]
			: []),
	];
	const graphNodeCount = handoff
		? Object.values(handoff.graphSummary.nodeCounts).reduce(
				(sum, count) => sum + count,
				0,
			)
		: 0;
	const graphEdgeCount = handoff
		? Object.values(handoff.graphSummary.edgeCounts).reduce(
				(sum, count) => sum + count,
				0,
			)
		: 0;

	const copy = async (value: string, label: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopyMessage(`${label}をコピーしました。`);
		} catch {
			setCopyMessage(`${label}をコピーできませんでした。`);
		}
	};

	return (
		<div className="intelligence-panel-stack">
			<section className="intelligence-handoff-boundary">
				<div>
					<span>Consumer boundary</span>
					<h2>Ontologyへ渡す前の候補データです</h2>
					<p>
						vulnWorkbenchは正式なProject
						Ontologyを管理しません。ここでは、NightWorkersがOntologyへ採用・対応付けするための構造候補と診断証跡を確認します。
					</p>
				</div>
				<StatusBadge
					status={pending ? "loading" : (handoff?.status ?? "missing")}
				/>
			</section>

			{error ? (
				<section className="projects-band" role="alert">
					<div className="projects-section-head">
						<div>
							<h2>Ontology Handoffを読み込めません</h2>
							<p>{error}</p>
						</div>
						<Button type="button" variant="secondary" onClick={onReload}>
							<RotateCcw className="icon" /> 再試行
						</Button>
					</div>
				</section>
			) : pending ? (
				<section className="projects-band" role="status" aria-busy="true">
					<h2>Ontology Handoffを読み込んでいます…</h2>
				</section>
			) : handoff ? (
				<>
					<section className="projects-band">
						<div className="projects-section-head">
							<div>
								<h2>Handoff readiness</h2>
								<p>
									Persisted
									payloadを取得できる状態です。NightWorkers側での接続・採用状態は不明です。
								</p>
							</div>
							<StatusBadge status={handoff.status} />
						</div>
						<div className="intelligence-structure-metrics compact">
							<Metric label="Modules" value={handoff.modules.length} />
							<Metric label="Graph nodes" value={graphNodeCount} />
							<Metric label="Graph edges" value={graphEdgeCount} />
							<Metric label="Source refs" value={handoff.sourceRefs.length} />
							<Metric
								label="Verification"
								value={handoff.verificationCommands.length}
							/>
						</div>
						<dl className="intelligence-definition-list wide">
							<dt>Generation</dt>
							<dd>
								<code>{handoff.generationId}</code>
							</dd>
							<dt>Snapshot</dt>
							<dd>
								<code>{handoff.snapshotRef}</code>
							</dd>
							<dt>Export hash</dt>
							<dd>
								<code>{handoff.exportHash}</code>
							</dd>
							<dt>Source tree</dt>
							<dd>
								<code>{handoff.sourceTreeHash}</code>
							</dd>
							<dt>Consumer</dt>
							<dd>{handoff.consumerBoundary.consumer}</dd>
							<dt>Canonical Ontology</dt>
							<dd>vulnWorkbenchは所有しません</dd>
						</dl>
					</section>

					<section className="projects-band">
						<div className="projects-section-head">
							<div>
								<h2>Module candidate payload</h2>
								<p>NightWorkersがcode evidenceとして取得する候補です。</p>
							</div>
						</div>
						<div className="intelligence-handoff-module-grid">
							{handoff.modules.map((module) => (
								<Link
									key={module.id}
									to="/projects/$projectId/intelligence"
									params={{ projectId }}
									search={{
										scanRunId,
										intelligenceView: "modules",
										moduleId: module.id,
									}}
								>
									<strong>{module.label}</strong>
									<span>{module.pathPrefix}</span>
									<small>
										{module.fileCount} files ·{" "}
										{module.internalDependencies.length} deps · confidence{" "}
										{module.confidence.toFixed(2)}
									</small>
								</Link>
							))}
						</div>
					</section>

					<section className="intelligence-handoff-grid">
						<article className="projects-band">
							<div className="projects-section-head">
								<div>
									<h2>Source refs</h2>
									<p>{handoff.sourceRefs.length}件</p>
								</div>
							</div>
							<div className="project-chip-cloud">
								{handoff.sourceRefs.slice(0, 40).map((ref) => (
									<span className="project-chip" key={ref}>
										{ref}
									</span>
								))}
							</div>
							{handoff.sourceRefs.length > 40 ? (
								<p className="intelligence-muted">
									ほか{handoff.sourceRefs.length - 40}件
								</p>
							) : null}
							<Button
								type="button"
								variant="secondary"
								onClick={() =>
									void copy(handoff.sourceRefs.join("\n"), "Source refs")
								}
							>
								<Copy className="icon" /> 一覧をコピー
							</Button>
						</article>
						<article className="projects-band">
							<div className="projects-section-head">
								<div>
									<h2>Verification candidates</h2>
									<p>実行前にNightWorkers側のpolicy確認が必要です。</p>
								</div>
							</div>
							<div className="command-list">
								{handoff.verificationCommands.map((command) => (
									<button
										type="button"
										key={command}
										onClick={() => void copy(command, "Verification command")}
									>
										<Copy className="icon" />
										<code>{command}</code>
									</button>
								))}
							</div>
							{handoff.verificationCommands.length === 0 ? (
								<p className="intelligence-muted">候補はありません。</p>
							) : null}
						</article>
					</section>

					<section className="projects-band">
						<div className="projects-section-head">
							<div>
								<h2>Manifest / MCP pull commands</h2>
								<p>外部システムへの自動送信は行いません。</p>
							</div>
						</div>
						<div className="command-list">
							{pullCommands.map((command) => (
								<button
									type="button"
									key={command}
									onClick={() => void copy(command, "Pull command")}
								>
									<Copy className="icon" />
									<code>{command}</code>
								</button>
							))}
						</div>
						{pullCommands.length === 0 ? (
							<p className="intelligence-muted">
								取得コマンドは生成されていません。
							</p>
						) : null}
					</section>
					<DegradedReasons reasons={handoff.degradedReasons} />
				</>
			) : (
				<section className="projects-band">
					<div className="projects-section-head">
						<div>
							<h2>Ontology Handoffは未生成です</h2>
							<p>
								generationを更新し、構造候補とprovenanceを生成してください。
							</p>
						</div>
						<StatusBadge status="missing" />
					</div>
				</section>
			)}

			{copyMessage ? (
				<p className="intelligence-copy-status" role="status">
					{copyMessage}
				</p>
			) : null}
			<AgentBundleSection
				scanRunId={scanRunId}
				agentMode={agentMode}
				agentPreview={agentPreview}
				agentLoading={agentLoading}
				onAgentModeChange={onAgentModeChange}
				onLoadAgentPreview={onLoadAgentPreview}
			/>
		</div>
	);
}
