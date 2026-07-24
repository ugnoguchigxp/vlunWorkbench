import { Link } from "@tanstack/react-router";
import { AlertTriangle, Copy, Network } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { formatCommandTokens } from "../../../../shared/format-command";
import type {
	DiagnosticEvidenceGraph,
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../../../shared/schemas/static-intelligence.schema";
import {
	agentModeToQueryKind,
	type fetchScanIntelligenceAgentQuery,
	type ProjectIntelligenceProject,
	type ProjectIntelligenceView,
	type ScanIntelligenceAgentMode,
	type ScanRun,
} from "../../api";
import { Button, SelectInput } from "../../ui";
import { formatScanOutcome } from "../scans/scan-profile-display";
import { formatDateTime } from "../scans/scans-utils";
import { countGraphKinds } from "./project-intelligence-view-model";

const agentModes: Array<{ id: ScanIntelligenceAgentMode; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "risk", label: "Risk" },
	{ id: "verification", label: "Verification" },
	{ id: "export", label: "Export" },
];

export function RiskDetail({ entry }: { entry: FileRiskIndexEntry | null }) {
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

export function EvidenceGraphSection({
	graph,
}: {
	graph: DiagnosticEvidenceGraph;
}) {
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

export function CodeStructureSection({
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

export function AgentBundleSection({
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

export function SourceHealthSection({
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

export function ScanRunList({
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

export function SummaryTile({
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

export function Metric({
	label,
	value,
}: {
	label: string;
	value: string | number;
}) {
	return (
		<div className="project-metric">
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}

export function StatusBadge({ status }: { status: string }) {
	return <span className={`project-status status-${status}`}>{status}</span>;
}

export function DegradedReasons({ reasons }: { reasons: string[] }) {
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
