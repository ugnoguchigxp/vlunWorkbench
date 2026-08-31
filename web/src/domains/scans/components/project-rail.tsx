import {
	ChevronDown,
	ChevronRight,
	Folder,
	FolderOpen,
	FolderPlus,
	LoaderCircle,
	Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Project, ScanRun } from "../../../api";
import { Button, TextInput } from "../../../ui";
import { ProjectActionsMenu } from "./project-actions-menu";
import { ScanActionsMenu } from "./scan-actions-menu";

const statusLabels: Record<ScanRun["status"], string> = {
	queued: "待機中",
	running: "実行中",
	completed: "完了",
	failed: "失敗",
	cancelled: "取消済み",
};

export function ProjectRail({
	projects,
	selectedProjectId,
	scanRuns,
	selectedScanRunId,
	onSelect,
	onSelectScan,
	onOpenHistory,
	onAdd,
	onDelete,
	onDeleteScan,
}: {
	projects: Project[];
	selectedProjectId: string;
	scanRuns: ScanRun[];
	selectedScanRunId: string;
	onSelect: (projectId: string) => void;
	onSelectScan: (scanRunId: string) => void;
	onOpenHistory: (project: Project) => void;
	onAdd: () => void;
	onDelete: (project: Project) => void;
	onDeleteScan: (scan: ScanRun) => void;
}) {
	const [query, setQuery] = useState("");
	const [expandedProjectId, setExpandedProjectId] = useState(selectedProjectId);
	useEffect(() => {
		setExpandedProjectId(selectedProjectId);
	}, [selectedProjectId]);
	const toggleProject = (projectId: string) => {
		if (projectId === selectedProjectId) {
			setExpandedProjectId((current) =>
				current === projectId ? "" : projectId,
			);
			return;
		}
		setExpandedProjectId(projectId);
		onSelect(projectId);
	};
	const openProjectHistory = (project: Project) => {
		setExpandedProjectId(project.id);
		onOpenHistory(project);
	};
	const visibleProjects = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		if (!normalized) return projects;
		return projects.filter((project) =>
			[project.name, project.defaultBranch, project.repoPath].some((value) =>
				value.toLocaleLowerCase().includes(normalized),
			),
		);
	}, [projects, query]);

	return (
		<aside className="workspace-project-rail" aria-label="登録済みプロジェクト">
			<div className="workspace-rail-heading">
				<div>
					<h2>プロジェクト</h2>
					<p>登録済み {projects.length}件</p>
				</div>
			</div>
			<search className="workspace-project-search">
				<Search className="icon" aria-hidden="true" />
				<TextInput
					aria-label="プロジェクトを検索"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="プロジェクトを検索"
				/>
			</search>
			<div className="workspace-project-list">
				{visibleProjects.length ? (
					visibleProjects.map((project) => {
						const selected = project.id === selectedProjectId;
						const expanded = selected && project.id === expandedProjectId;
						const projectScanRuns = scanRuns.filter(
							(scan) => scan.projectId === project.id,
						);
						return (
							<div key={project.id} className="workspace-project-node">
								<div
									className={
										selected
											? "workspace-project-item selected"
											: "workspace-project-item"
									}
								>
									<button
										type="button"
										className="workspace-project-select"
										aria-expanded={expanded}
										onClick={() => toggleProject(project.id)}
									>
										<span
											className="workspace-project-folder"
											aria-hidden="true"
										>
											{expanded ? <ChevronDown /> : <ChevronRight />}
											{expanded ? <FolderOpen /> : <Folder />}
										</span>
										<span className="workspace-project-copy">
											<strong title={project.name}>{project.name}</strong>
											<span title={project.defaultBranch}>
												{project.defaultBranch || "既定ブランチ未設定"}
											</span>
										</span>
									</button>
									<ProjectActionsMenu
										project={project}
										onOpenHistory={openProjectHistory}
										onDelete={onDelete}
									/>
								</div>
								{expanded ? (
									<section
										className="workspace-project-scan-tree"
										aria-label={`${project.name} のスキャン履歴`}
									>
										{projectScanRuns.length ? (
											projectScanRuns.map((scan) => {
												const active =
													scan.status === "queued" || scan.status === "running";
												return (
													<div
														key={scan.id}
														className="workspace-project-scan-item"
													>
														<button
															type="button"
															className={
																scan.id === selectedScanRunId ? "selected" : ""
															}
															onClick={() => onSelectScan(scan.id)}
														>
															{active ? (
																<LoaderCircle
																	className="workspace-scan-spinner"
																	aria-label={statusLabels[scan.status]}
																/>
															) : (
																<span
																	className={`workspace-scan-state-dot ${scan.status}`}
																	aria-hidden="true"
																/>
															)}
															<span className="workspace-project-scan-copy">
																<strong>{scan.profile}</strong>
																<span>
																	{statusLabels[scan.status]} ·{" "}
																	{new Date(scan.createdAt).toLocaleString(
																		"ja-JP",
																	)}
																</span>
															</span>
														</button>
														<ScanActionsMenu
															scan={scan}
															onDelete={onDeleteScan}
														/>
													</div>
												);
											})
										) : (
											<p className="workspace-project-scan-empty">
												スキャン履歴はありません。
											</p>
										)}
									</section>
								) : null}
							</div>
						);
					})
				) : (
					<p className="workspace-empty">
						{projects.length
							? "一致するプロジェクトはありません。"
							: "プロジェクトを登録してください。"}
					</p>
				)}
			</div>
			<Button type="button" variant="outline" full onClick={onAdd}>
				<FolderPlus className="icon" />
				プロジェクトを追加
			</Button>
		</aside>
	);
}
