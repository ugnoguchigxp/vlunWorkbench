import { FolderPlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Project } from "../../../api";
import { Button, TextInput } from "../../../ui";
import { ProjectActionsMenu } from "./project-actions-menu";

export function ProjectRail({
	projects,
	selectedProjectId,
	onSelect,
	onOpenHistory,
	onAdd,
	onDelete,
}: {
	projects: Project[];
	selectedProjectId: string;
	onSelect: (projectId: string) => void;
	onOpenHistory: (project: Project) => void;
	onAdd: () => void;
	onDelete: (project: Project) => void;
}) {
	const [query, setQuery] = useState("");
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
					visibleProjects.map((project) => (
						<div
							key={project.id}
							className={
								project.id === selectedProjectId
									? "workspace-project-item selected"
									: "workspace-project-item"
							}
						>
							<button
								type="button"
								className="workspace-project-select"
								onClick={() => onSelect(project.id)}
							>
								<span className="workspace-project-copy">
									<strong title={project.name}>{project.name}</strong>
									<span title={project.defaultBranch}>
										{project.defaultBranch || "既定ブランチ未設定"}
									</span>
								</span>
							</button>
							<ProjectActionsMenu
								project={project}
								onOpenHistory={onOpenHistory}
								onDelete={onDelete}
							/>
						</div>
					))
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
