import { History, MoreHorizontal, Trash2 } from "lucide-react";
import type { Project } from "../../../api";
import { Menu, MenuDivider, MenuItem } from "../../../components/menu";

export function ProjectActionsMenu({
	project,
	onOpenHistory,
	onDelete,
}: {
	project: Project;
	onOpenHistory: (project: Project) => void;
	onDelete: (project: Project) => void;
}) {
	return (
		<Menu
			label={`プロジェクト「${project.name}」の操作`}
			trigger={<MoreHorizontal className="icon" aria-hidden="true" />}
		>
			<MenuItem onSelect={() => onOpenHistory(project)}>
				<History className="icon" aria-hidden="true" />
				スキャン履歴
			</MenuItem>
			<MenuDivider />
			<MenuItem danger onSelect={() => onDelete(project)}>
				<Trash2 className="icon" aria-hidden="true" />
				プロジェクトを削除
			</MenuItem>
		</Menu>
	);
}
