import type { Project } from "../../../api";
import { Menu, MenuItem } from "../../../components/menu";

export function ProjectActionsMenu({
	project,
	onDelete,
}: {
	project: Project;
	onDelete: (project: Project) => void;
}) {
	return (
		<Menu label={`プロジェクト「${project.name}」の操作`}>
			<MenuItem danger onSelect={() => onDelete(project)}>
				プロジェクトを削除
			</MenuItem>
		</Menu>
	);
}
