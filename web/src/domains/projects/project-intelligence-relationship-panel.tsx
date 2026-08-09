import { Link } from "@tanstack/react-router";
import { ChevronRight, Network, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceModuleCandidate } from "../../../../shared/schemas/static-intelligence-module.schema";
import type { ProjectStructureSummaryResponse } from "../../api";
import { Button } from "../../ui";
import { EvidenceGraphSection, Metric } from "./project-detail-sections";
import {
	buildModuleRelationshipContext,
	countGraphItems,
	sortModuleCandidates,
} from "./project-intelligence-structure-model";
import {
	type IntelligenceResourceStatus,
	useProjectStructureReferences,
} from "./use-intelligence-structure-data";

export function IntelligenceRelationshipPanel({
	projectId,
	scanRunId,
	generationId,
	structure,
	structureStatus,
	structureError,
	selectedModule,
	exportPayload,
	onReloadStructure,
}: {
	projectId: string;
	scanRunId: string;
	generationId: string;
	structure: ProjectStructureSummaryResponse | null;
	structureStatus: IntelligenceResourceStatus;
	structureError: string | null;
	selectedModule: StaticIntelligenceModuleCandidate | null;
	exportPayload: StaticIntelligenceExportV1;
	onReloadStructure: () => void;
}) {
	const [mode, setMode] = useState<"modules" | "evidence">("modules");
	const relationship = selectedModule
		? buildModuleRelationshipContext(
				structure?.modules ?? [],
				selectedModule.id,
			)
		: null;
	const references = useProjectStructureReferences({
		projectId,
		scanRunId,
		generationId,
		moduleId: selectedModule?.id ?? null,
		enabled: mode === "modules" && Boolean(selectedModule),
	});
	const modules = sortModuleCandidates(structure?.modules ?? []);
	const graphCounts = countGraphItems(exportPayload);
	const pending = structureStatus === "idle" || structureStatus === "loading";

	return (
		<div className="intelligence-panel-stack">
			<section className="projects-band intelligence-relationship-head">
				<div className="projects-section-head">
					<div>
						<h2>関係マップ</h2>
						<p>
							構造上の依存関係を主表示にし、診断証跡を必要に応じて重ねます。
						</p>
					</div>
					<fieldset className="intelligence-view-switch">
						<legend className="intelligence-visually-hidden">
							関係マップの表示
						</legend>
						<Button
							type="button"
							variant={mode === "modules" ? "primary" : "secondary"}
							onClick={() => setMode("modules")}
						>
							<Network className="icon" /> モジュール依存
						</Button>
						<Button
							type="button"
							variant={mode === "evidence" ? "primary" : "secondary"}
							onClick={() => setMode("evidence")}
						>
							<ShieldCheck className="icon" /> 診断証跡
						</Button>
					</fieldset>
				</div>
				<div className="intelligence-structure-metrics compact">
					<Metric label="Modules" value={pending ? "…" : modules.length} />
					<Metric
						label="Module edges"
						value={
							pending
								? "…"
								: modules.reduce(
										(count, module) =>
											count + module.internalDependencies.length,
										0,
									)
						}
					/>
					<Metric
						label="Graph nodes"
						value={exportPayload.graph.nodes.length}
					/>
					<Metric
						label="Graph edges"
						value={exportPayload.graph.edges.length}
					/>
					<Metric label="検出事項" value={exportPayload.scan.findingCount} />
				</div>
			</section>

			{structureError ? (
				<section className="projects-band" role="alert">
					<div className="projects-section-head">
						<div>
							<h2>構造関係を読み込めません</h2>
							<p>{structureError}</p>
						</div>
						<Button
							type="button"
							variant="secondary"
							onClick={onReloadStructure}
						>
							<RotateCcw className="icon" /> 再試行
						</Button>
					</div>
				</section>
			) : mode === "evidence" ? (
				<>
					<section className="projects-band">
						<div className="projects-section-head">
							<div>
								<h2>Diagnostic Evidence overlay</h2>
								<p>
									Graphは証跡へ到達するためのread modelであり、source of
									truthではありません。
								</p>
							</div>
						</div>
						<div className="project-chip-cloud">
							{Object.entries(graphCounts.nodes).map(([kind, count]) => (
								<span className="project-chip" key={`node-${kind}`}>
									{kind}: {count}
								</span>
							))}
							{Object.entries(graphCounts.edges).map(([kind, count]) => (
								<span className="project-chip" key={`edge-${kind}`}>
									{kind}: {count}
								</span>
							))}
						</div>
						{exportPayload.scan.findingCount === 0 ? (
							<p className="intelligence-muted">
								このgenerationには検出事項のoverlayがありません。Module
								dependenciesへ切り替えると構造関係を確認できます。
							</p>
						) : null}
					</section>
					<EvidenceGraphSection graph={exportPayload.graph} />
				</>
			) : (
				<section className="intelligence-relationship-layout">
					<nav
						className="intelligence-relationship-modules"
						aria-label="関係を確認するモジュール"
					>
						{modules.map((module) => (
							<Link
								key={module.id}
								to="/projects/$projectId/intelligence"
								params={{ projectId }}
								search={{
									scanRunId,
									intelligenceView: "relationships",
									moduleId: module.id,
								}}
								className={selectedModule?.id === module.id ? "selected" : ""}
							>
								<strong>{module.label}</strong>
								<span>{module.pathPrefix}</span>
								<small>
									{module.internalDependencies.length} outbound ·{" "}
									{module.fileCount} files
								</small>
							</Link>
						))}
						{pending ? (
							<p role="status">モジュール関係を読み込んでいます…</p>
						) : null}
					</nav>
					<div className="intelligence-relationship-detail">
						{relationship ? (
							<>
								<header className="projects-section-head">
									<div>
										<span className="project-chip">選択中</span>
										<h2>{relationship.module.label}</h2>
										<p>{relationship.module.pathPrefix}</p>
									</div>
									<Link
										to="/projects/$projectId/intelligence"
										params={{ projectId }}
										search={{
											scanRunId,
											intelligenceView: "modules",
											moduleId: relationship.module.id,
										}}
										className="project-open-link"
									>
										モジュールで開く <ChevronRight className="icon" />
									</Link>
								</header>
								<div className="intelligence-relationship-columns">
									<RelationshipList
										title="Inbound"
										modules={relationship.inbound}
										projectId={projectId}
										scanRunId={scanRunId}
									/>
									<RelationshipList
										title="Outbound"
										modules={relationship.outbound}
										projectId={projectId}
										scanRunId={scanRunId}
									/>
								</div>
								{relationship.unresolvedOutbound.length > 0 ? (
									<div className="intelligence-inline-warning">
										<strong>候補へ解決できない内部依存</strong>
										<p>{relationship.unresolvedOutbound.join(", ")}</p>
									</div>
								) : null}
								<section className="intelligence-reference-table">
									<div className="projects-section-head">
										<div>
											<h3>Typed references</h3>
											<p>{references.data?.total ?? 0}件</p>
										</div>
										{references.error ? (
											<Button
												type="button"
												variant="secondary"
												onClick={() => void references.reload()}
											>
												<RotateCcw className="icon" /> 再試行
											</Button>
										) : null}
									</div>
									{references.error ? (
										<p className="intelligence-inline-error" role="alert">
											{references.error}
										</p>
									) : null}
									<section
										className="project-table-wrap"
										aria-label="選択したモジュールの参照関係一覧"
										/* biome-ignore lint/a11y/noNoninteractiveTabindex: The horizontally scrollable table needs a keyboard focus target. */
										tabIndex={0}
									>
										<table className="project-table">
											<thead>
												<tr>
													<th>From</th>
													<th>Relation</th>
													<th>Target</th>
													<th>Status</th>
													<th>Confidence</th>
												</tr>
											</thead>
											<tbody>
												{references.data?.items.map((reference) => (
													<tr
														key={`${reference.from}:${reference.specifier}:${reference.kind}:${reference.status}:${reference.target ?? ""}:${reference.resolverId}`}
													>
														<td>
															<code>{reference.from}</code>
														</td>
														<td>{reference.kind}</td>
														<td>
															<code>
																{reference.target ?? reference.specifier}
															</code>
														</td>
														<td>{reference.status}</td>
														<td>{reference.confidence.toFixed(2)}</td>
													</tr>
												))}
											</tbody>
										</table>
									</section>
									{references.status === "loading" ? (
										<p role="status">参照関係を読み込んでいます…</p>
									) : null}
									{references.data?.nextCursor !== null &&
									references.data?.nextCursor !== undefined ? (
										<Button
											type="button"
											variant="secondary"
											onClick={() => void references.loadMore()}
											disabled={references.status === "loading"}
										>
											{references.status === "loading"
												? "読込中…"
												: "さらに参照を読み込む"}
										</Button>
									) : null}
								</section>
							</>
						) : (
							<div className="projects-empty">
								モジュール候補は生成されていません。
							</div>
						)}
					</div>
				</section>
			)}
		</div>
	);
}

function RelationshipList({
	title,
	modules,
	projectId,
	scanRunId,
}: {
	title: string;
	modules: readonly StaticIntelligenceModuleCandidate[];
	projectId: string;
	scanRunId: string;
}) {
	return (
		<section>
			<h3>{title}</h3>
			{modules.length > 0 ? (
				<ul>
					{modules.map((module) => (
						<li key={module.id}>
							<Link
								to="/projects/$projectId/intelligence"
								params={{ projectId }}
								search={{
									scanRunId,
									intelligenceView: "relationships",
									moduleId: module.id,
								}}
							>
								<strong>{module.label}</strong>
								<span>{module.pathPrefix}</span>
								<ChevronRight className="icon" />
							</Link>
						</li>
					))}
				</ul>
			) : (
				<p className="intelligence-muted">関係はありません。</p>
			)}
		</section>
	);
}
