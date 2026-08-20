import { FolderPlus } from "lucide-react";
import type { Project } from "../../../api";
import { Button } from "../../../ui";
import { ProjectActionsMenu } from "./project-actions-menu";

export function ProjectRail({
	projects,
	selectedProjectId,
	onSelect,
	onAdd,
	onDelete,
}: {
	projects: Project[];
	selectedProjectId: string;
	onSelect: (projectId: string) => void;
	onAdd: () => void;
	onDelete: (project: Project) => void;
}) {
	return (
		<aside className="workspace-project-rail" aria-label="登録済みプロジェクト">
			<div className="workspace-rail-heading">
				<div>
					<h2>登録済みプロジェクト</h2>
					<p>{projects.length} 件</p>
				</div>
				<Button
					type="button"
					variant="secondary"
					aria-label="新規プロジェクト"
					onClick={onAdd}
				>
					<FolderPlus className="icon" />
					追加
				</Button>
			</div>
			<div className="workspace-project-list">
				{projects.length ? (
					projects.map((project) => (
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
								<strong>{project.name}</strong>
								<span>{project.defaultBranch}</span>
							</button>
							<ProjectActionsMenu project={project} onDelete={onDelete} />
						</div>
					))
				) : (
					<p className="workspace-empty">プロジェクトを登録してください。</p>
				)}
			</div>
		</aside>
	);
}
