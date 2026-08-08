import { Filter, RotateCcw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { Finding } from "../../api";
import { Button, SelectInput, TextInput } from "../../ui";
import { IntelligenceFindingDetail } from "./project-intelligence-finding-detail";
import { IntelligencePaginationButton } from "./project-intelligence-pagination-button";
import {
	buildFindingIndex,
	sortFileRiskEntries,
} from "./project-intelligence-workspace-model";
import type { FindingDetail } from "./use-intelligence-workspace-data";

type ResourceStatus = "idle" | "loading" | "loaded" | "failed";

export function IntelligenceInvestigationPanel({
	projectId,
	scanRunId,
	exportPayload,
	focusPath,
	findings,
	findingsStatus,
	findingsError,
	hasMoreFindings,
	onReloadFindings,
	onLoadMoreFindings,
	details,
	detailStatus,
	detailErrors,
	onLoadFinding,
}: {
	projectId: string;
	scanRunId: string;
	exportPayload: StaticIntelligenceExportV1;
	focusPath: string | null;
	findings: Finding[];
	findingsStatus: ResourceStatus;
	findingsError: string | null;
	hasMoreFindings: boolean;
	onReloadFindings: () => void;
	onLoadMoreFindings: () => void;
	details: Record<string, FindingDetail>;
	detailStatus: Record<string, ResourceStatus>;
	detailErrors: Record<string, string | null>;
	onLoadFinding: (findingId: string, force?: boolean) => Promise<void>;
}) {
	const [query, setQuery] = useState("");
	const [severity, setSeverity] = useState("all");
	const [scanner, setScanner] = useState("all");
	const sortedEntries = useMemo(
		() => sortFileRiskEntries(exportPayload.fileRiskIndex),
		[exportPayload.fileRiskIndex],
	);
	const scanners = useMemo(
		() =>
			[...new Set(sortedEntries.flatMap((entry) => entry.scanners))].sort(
				(a, b) => a.localeCompare(b),
			),
		[sortedEntries],
	);
	const visibleEntries = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		return sortedEntries.filter(
			(entry) =>
				(!normalizedQuery ||
					entry.path.toLowerCase().includes(normalizedQuery)) &&
				(severity === "all" || entry.maxSeverity === severity) &&
				(scanner === "all" || entry.scanners.includes(scanner)),
		);
	}, [query, scanner, severity, sortedEntries]);
	const [selectedPath, setSelectedPath] = useState<string | null>(
		focusPath && sortedEntries.some((entry) => entry.path === focusPath)
			? focusPath
			: (sortedEntries[0]?.path ?? null),
	);
	const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
		null,
	);
	const findingIndex = useMemo(() => buildFindingIndex(findings), [findings]);
	const selectedEntry =
		visibleEntries.find((entry) => entry.path === selectedPath) ?? null;
	const selectedFindings = useMemo(() => {
		if (!selectedEntry) return [];
		const ids = new Set(selectedEntry.findingIds);
		const listed = selectedEntry.findingIds
			.map((id) => findingIndex.byId.get(id))
			.filter((item): item is Finding => Boolean(item));
		for (const item of findingIndex.byPath.get(selectedEntry.path) ?? []) {
			if (!ids.has(item.id)) listed.push(item);
		}
		return listed;
	}, [findingIndex, selectedEntry]);
	const selectedFinding = selectedFindingId
		? (findingIndex.byId.get(selectedFindingId) ??
			details[selectedFindingId]?.finding ??
			null)
		: null;

	useEffect(() => {
		if (focusPath && visibleEntries.some((entry) => entry.path === focusPath)) {
			setSelectedPath(focusPath);
		}
	}, [focusPath, visibleEntries]);

	useEffect(() => {
		if (
			selectedPath &&
			visibleEntries.some((entry) => entry.path === selectedPath)
		)
			return;
		setSelectedPath(visibleEntries[0]?.path ?? null);
	}, [selectedPath, visibleEntries]);

	useEffect(() => {
		if (
			selectedFindingId &&
			selectedFindings.some((item) => item.id === selectedFindingId)
		)
			return;
		const nextId =
			selectedFindings[0]?.id ?? selectedEntry?.findingIds[0] ?? null;
		setSelectedFindingId(nextId);
	}, [selectedEntry, selectedFindingId, selectedFindings]);

	useEffect(() => {
		if (selectedFindingId) void onLoadFinding(selectedFindingId);
	}, [onLoadFinding, selectedFindingId]);

	return (
		<section className="intelligence-investigation" aria-label="Finding調査">
			<aside className="intelligence-investigation-master">
				<header>
					<div>
						<h2>調査対象</h2>
						<p>{visibleEntries.length}ファイル</p>
					</div>
					<Filter className="icon" />
				</header>
				<div className="intelligence-filter-stack">
					<label htmlFor="intelligence-investigation-path">
						<span>Path</span>
						<div className="intelligence-search-field">
							<Search className="icon" />
							<TextInput
								id="intelligence-investigation-path"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="src/auth…"
							/>
						</div>
					</label>
					<div className="intelligence-filter-row">
						<label htmlFor="intelligence-investigation-severity">
							<span>Severity</span>
							<SelectInput
								id="intelligence-investigation-severity"
								value={severity}
								onChange={(event) => setSeverity(event.target.value)}
							>
								<option value="all">すべて</option>
								{["critical", "high", "medium", "low", "info", "unknown"].map(
									(value) => (
										<option key={value} value={value}>
											{value}
										</option>
									),
								)}
							</SelectInput>
						</label>
						<label htmlFor="intelligence-investigation-scanner">
							<span>Scanner</span>
							<SelectInput
								id="intelligence-investigation-scanner"
								value={scanner}
								onChange={(event) => setScanner(event.target.value)}
							>
								<option value="all">すべて</option>
								{scanners.map((value) => (
									<option key={value} value={value}>
										{value}
									</option>
								))}
							</SelectInput>
						</label>
					</div>
				</div>
				{findingsError ? (
					<div className="intelligence-inline-error" role="alert">
						<span>{findingsError}</span>
						<Button
							type="button"
							variant="secondary"
							onClick={hasMoreFindings ? onLoadMoreFindings : onReloadFindings}
						>
							<RotateCcw className="icon" /> 再試行
						</Button>
					</div>
				) : null}
				<div className="intelligence-risk-file-list">
					{visibleEntries.map((entry) => (
						<div className="intelligence-risk-file" key={entry.path}>
							<button
								type="button"
								className={selectedPath === entry.path ? "selected" : ""}
								onClick={() => setSelectedPath(entry.path)}
								aria-expanded={selectedPath === entry.path}
							>
								<span className="intelligence-risk-file-copy">
									<strong>{entry.path}</strong>
									<small>{entry.scanners.join(", ") || "scanner不明"}</small>
								</span>
								<span className={`project-chip severity-${entry.maxSeverity}`}>
									{entry.maxSeverity}
								</span>
								<strong>{entry.findingCount}</strong>
							</button>
							{selectedPath === entry.path ? (
								<div className="intelligence-file-findings">
									{["idle", "loading"].includes(findingsStatus) &&
									selectedFindings.length === 0 ? (
										<p role="status">Findingを読み込んでいます…</p>
									) : selectedFindings.length > 0 ? (
										selectedFindings.map((finding) => (
											<button
												type="button"
												key={finding.id}
												className={
													selectedFindingId === finding.id ? "selected" : ""
												}
												onClick={() => setSelectedFindingId(finding.id)}
											>
												<span
													className={`severity-dot severity-${finding.severity}`}
												/>
												<span>{finding.title}</span>
											</button>
										))
									) : !findingsError ? (
										<p>Finding詳細は現在の一覧にありません。</p>
									) : null}
								</div>
							) : null}
						</div>
					))}
					{visibleEntries.length === 0 ? (
						<div className="projects-empty compact">
							条件に一致するファイルはありません。
						</div>
					) : null}
					{hasMoreFindings && !findingsError ? (
						<IntelligencePaginationButton
							loading={findingsStatus === "loading"}
							onLoadMore={onLoadMoreFindings}
						/>
					) : null}
				</div>
			</aside>
			<div className="intelligence-investigation-detail">
				<IntelligenceFindingDetail
					projectId={projectId}
					scanRunId={scanRunId}
					finding={selectedFinding}
					detail={
						selectedFindingId ? (details[selectedFindingId] ?? null) : null
					}
					status={
						selectedFindingId
							? (detailStatus[selectedFindingId] ?? "idle")
							: "idle"
					}
					error={
						selectedFindingId ? (detailErrors[selectedFindingId] ?? null) : null
					}
					graph={exportPayload.graph}
					onRetry={() => {
						if (selectedFindingId) void onLoadFinding(selectedFindingId, true);
					}}
				/>
			</div>
		</section>
	);
}
