import { Link } from "@tanstack/react-router";
import { ChevronRight, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { StaticIntelligenceModuleCandidate } from "../../../../shared/schemas/static-intelligence-module.schema";
import type { ProjectStructureSummaryResponse } from "../../api";
import { Button, SelectInput, TextInput } from "../../ui";
import { Metric } from "./project-detail-sections";
import {
	buildModuleRelationshipContext,
	filterModuleCandidates,
	type ModuleFilters,
} from "./project-intelligence-structure-model";
import {
	type IntelligenceResourceStatus,
	useProjectStructureFiles,
} from "./use-intelligence-structure-data";

export function IntelligenceModulePanel({
	projectId,
	scanRunId,
	generationId,
	structure,
	structureStatus,
	structureError,
	selectedModule,
	focusPath,
	onReloadStructure,
}: {
	projectId: string;
	scanRunId: string;
	generationId: string;
	structure: ProjectStructureSummaryResponse | null;
	structureStatus: IntelligenceResourceStatus;
	structureError: string | null;
	selectedModule: StaticIntelligenceModuleCandidate | null;
	focusPath: string | null;
	onReloadStructure: () => void;
}) {
	const [query, setQuery] = useState("");
	const [confidence, setConfidence] =
		useState<ModuleFilters["confidence"]>("all");
	const [riskOnly, setRiskOnly] = useState(false);
	const modules = useMemo(
		() =>
			filterModuleCandidates(structure?.modules ?? [], {
				query,
				confidence,
				riskOnly,
			}),
		[confidence, query, riskOnly, structure?.modules],
	);
	const relationship = selectedModule
		? buildModuleRelationshipContext(
				structure?.modules ?? [],
				selectedModule.id,
			)
		: null;
	const files = useProjectStructureFiles({
		projectId,
		scanRunId,
		generationId,
		moduleId: selectedModule?.id ?? null,
		enabled: Boolean(selectedModule),
	});
	const pending = structureStatus === "idle" || structureStatus === "loading";
	const selectedModuleHidden = Boolean(
		selectedModule &&
			!modules.some((module) => module.id === selectedModule.id),
	);

	if (structureError && !structure) {
		return (
			<section className="projects-band" role="alert">
				<div className="projects-section-head">
					<div>
						<h2>モジュール候補を読み込めません</h2>
						<p>{structureError}</p>
					</div>
					<Button type="button" variant="secondary" onClick={onReloadStructure}>
						<RotateCcw className="icon" /> 再試行
					</Button>
				</div>
			</section>
		);
	}

	return (
		<section
			className="intelligence-module-layout"
			aria-label="モジュール候補の探索"
		>
			<aside className="intelligence-module-sidebar">
				<header>
					<div>
						<h2>モジュール候補</h2>
						<p>
							{pending
								? "読込中…"
								: `${modules.length} / ${structure?.modules.length ?? 0}件`}
						</p>
					</div>
				</header>
				<div className="intelligence-module-filters">
					<label htmlFor="intelligence-module-query">
						<span>検索</span>
						<div className="intelligence-search-field">
							<Search className="icon" />
							<TextInput
								id="intelligence-module-query"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="module、path、package…"
							/>
						</div>
					</label>
					<label htmlFor="intelligence-module-confidence">
						<span>Confidence</span>
						<SelectInput
							id="intelligence-module-confidence"
							value={confidence}
							onChange={(event) =>
								setConfidence(event.target.value as ModuleFilters["confidence"])
							}
						>
							<option value="all">すべて</option>
							<option value="high">High</option>
							<option value="medium">Medium</option>
							<option value="low">Low</option>
						</SelectInput>
					</label>
					<label className="intelligence-checkbox">
						<input
							type="checkbox"
							checked={riskOnly}
							onChange={(event) => setRiskOnly(event.target.checked)}
						/>
						<span>検出事項のoverlayあり</span>
					</label>
				</div>
				{selectedModuleHidden ? (
					<div className="intelligence-inline-warning intelligence-filter-warning">
						<p>選択中のモジュールはフィルターで非表示です。</p>
						<Button
							type="button"
							variant="secondary"
							onClick={() => {
								setQuery("");
								setConfidence("all");
								setRiskOnly(false);
							}}
						>
							フィルターを解除
						</Button>
					</div>
				) : null}
				<nav className="intelligence-module-list" aria-label="モジュール候補">
					{modules.map((module) => (
						<Link
							key={module.id}
							to="/projects/$projectId/intelligence"
							params={{ projectId }}
							search={{
								scanRunId,
								intelligenceView: "modules",
								moduleId: module.id,
							}}
							className={selectedModule?.id === module.id ? "selected" : ""}
						>
							<span>
								<strong>{module.label}</strong>
								<small>{module.pathPrefix}</small>
							</span>
							<small>
								{module.fileCount} files · {module.internalDependencies.length}{" "}
								deps
							</small>
						</Link>
					))}
					{!pending && modules.length === 0 ? (
						<p>条件に一致する候補はありません。</p>
					) : null}
				</nav>
			</aside>

			<div className="intelligence-module-detail">
				{selectedModule ? (
					<>
						<header className="projects-section-head">
							<div>
								<span className="project-chip">モジュール候補</span>
								<h2>{selectedModule.label}</h2>
								<p>{selectedModule.pathPrefix}</p>
							</div>
							<Link
								to="/projects/$projectId/intelligence"
								params={{ projectId }}
								search={{
									scanRunId,
									intelligenceView: "relationships",
									moduleId: selectedModule.id,
								}}
								className="project-open-link"
							>
								関係マップで開く <ChevronRight className="icon" />
							</Link>
						</header>
						<div className="intelligence-structure-metrics compact">
							<Metric label="Files" value={selectedModule.fileCount} />
							<Metric
								label="Entrypoints"
								value={selectedModule.entrypointFiles.length}
							/>
							<Metric
								label="Inbound"
								value={relationship?.inbound.length ?? 0}
							/>
							<Metric
								label="Outbound"
								value={relationship?.outbound.length ?? 0}
							/>
							<Metric
								label="Packages"
								value={selectedModule.packageDependencies.length}
							/>
							<Metric
								label="Confidence"
								value={selectedModule.confidence.toFixed(2)}
							/>
						</div>
						<div className="intelligence-module-detail-grid">
							<ModuleFact
								title="Entrypoints"
								values={selectedModule.entrypointFiles}
							/>
							<ModuleLinks
								title="Inbound modules"
								modules={relationship?.inbound ?? []}
								projectId={projectId}
								scanRunId={scanRunId}
							/>
							<ModuleLinks
								title="Outbound modules"
								modules={relationship?.outbound ?? []}
								projectId={projectId}
								scanRunId={scanRunId}
							/>
							<ModuleFact
								title="External packages"
								values={selectedModule.packageDependencies}
							/>
							<ModuleFact
								title="Exported symbols"
								values={selectedModule.exportedSymbols}
							/>
							<ModuleFact
								title="Inference reasons"
								values={selectedModule.reasons}
							/>
						</div>
						<section className="intelligence-module-files">
							<div className="projects-section-head">
								<div>
									<h3>Module files</h3>
									<p>{files.total ?? selectedModule.fileCount}件</p>
								</div>
								{files.error ? (
									<Button
										type="button"
										variant="secondary"
										onClick={files.reload}
									>
										<RotateCcw className="icon" /> 再試行
									</Button>
								) : null}
							</div>
							{files.error ? (
								<p className="intelligence-inline-error" role="alert">
									{files.error}
								</p>
							) : null}
							<section
								className="project-table-wrap"
								aria-label="選択したモジュールのファイル一覧"
								/* biome-ignore lint/a11y/noNoninteractiveTabindex: The horizontally scrollable table needs a keyboard focus target. */
								tabIndex={0}
							>
								<table className="project-table">
									<thead>
										<tr>
											<th>File</th>
											<th>Language</th>
											<th>Tags</th>
											<th>Analysis</th>
											<th>Refs</th>
											<th>Exports</th>
										</tr>
									</thead>
									<tbody>
										{files.items.map((file) => (
											<tr
												key={file.path}
												className={focusPath === file.path ? "selected" : ""}
											>
												<td>
													<code>{file.path}</code>
													{file.risk ? (
														<span
															className={`project-chip severity-${file.risk.maxSeverity}`}
														>
															{file.risk.maxSeverity}
														</span>
													) : null}
												</td>
												<td>{file.language}</td>
												<td>{file.tags.join(", ") || "—"}</td>
												<td>{file.analysisStatus}</td>
												<td>{file.referenceCount}</td>
												<td>{file.exportCount}</td>
											</tr>
										))}
									</tbody>
								</table>
							</section>
							{files.status === "loading" && files.items.length === 0 ? (
								<p role="status">ファイルを読み込んでいます…</p>
							) : null}
							{files.nextCursor !== null ? (
								<Button
									type="button"
									variant="secondary"
									onClick={() => void files.loadMore()}
									disabled={files.status === "loading"}
								>
									{files.status === "loading"
										? "読込中…"
										: "さらにファイルを読み込む"}
								</Button>
							) : null}
						</section>
					</>
				) : pending ? (
					<div className="projects-empty" role="status">
						モジュール候補を読み込んでいます…
					</div>
				) : (
					<div className="projects-empty">
						モジュール候補は生成されていません。
					</div>
				)}
			</div>
		</section>
	);
}

function ModuleFact({
	title,
	values,
}: {
	title: string;
	values: readonly string[];
}) {
	const shown = values.slice(0, 20);
	return (
		<article>
			<h3>{title}</h3>
			<div className="project-chip-cloud">
				{shown.length > 0 ? (
					shown.map((value) => (
						<span className="project-chip" key={value}>
							{value}
						</span>
					))
				) : (
					<span className="intelligence-muted">なし</span>
				)}
				{values.length > shown.length ? (
					<span className="project-chip">
						ほか{values.length - shown.length}件
					</span>
				) : null}
			</div>
		</article>
	);
}

function ModuleLinks({
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
		<article>
			<h3>{title}</h3>
			<div className="project-chip-cloud">
				{modules.length > 0 ? (
					modules.map((module) => (
						<Link
							key={module.id}
							className="project-chip"
							to="/projects/$projectId/intelligence"
							params={{ projectId }}
							search={{
								scanRunId,
								intelligenceView: "modules",
								moduleId: module.id,
							}}
						>
							{module.label}
						</Link>
					))
				) : (
					<span className="intelligence-muted">なし</span>
				)}
			</div>
		</article>
	);
}
