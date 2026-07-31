import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCommandTokens } from "../../../../shared/format-command";
import type {
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceOntologyHandoff } from "../../../../shared/schemas/static-intelligence-module.schema";
import type {
	ProjectIntelligenceView,
	ProjectStructureListResponse,
} from "../../api";
import {
	CodeStructureSection,
	DegradedReasons,
	Metric,
	RiskDetail,
	StatusBadge,
} from "./project-detail-sections";

const severityOrder = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

export function StructureExplorer({
	structure,
	exportPayload,
}: {
	structure: ProjectStructureListResponse | null;
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
				</div>
				<StatusBadge status={structure.status} />
			</div>
			{structure.summary && structure.coverage ? (
				<p className="project-structure-coverage">
					coverage: {structure.summary.analyzedFileCount}/
					{structure.coverage.includedFileCount} analyzed ·{" "}
					{structure.summary.resolvedReferenceCount} references resolved ·{" "}
					{structure.coverage.unsupportedFileCount} unsupported (inventory only)
					· {structure.summary.resourceFileCount} resources
					{structure.readiness?.resolution.status === "degraded"
						? ` · resolver: ${structure.readiness.resolution.reasonCodes.join(", ")}`
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
									<th>Analysis</th>
									<th>References</th>
									<th>Exports</th>
									<th>Risk</th>
								</tr>
							</thead>
							<tbody>
								{files.map((file) => (
									<tr key={file.path}>
										<td>{file.path}</td>
										<td>{file.tags.join(", ")}</td>
										<td>{file.analysisStatus}</td>
										<td>{file.referenceCount}</td>
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

export function OntologyHandoffSection({
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
					"project_structure_snapshot",
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

export function FileRiskSection({
	entries,
}: {
	entries: FileRiskIndexEntry[];
}) {
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
