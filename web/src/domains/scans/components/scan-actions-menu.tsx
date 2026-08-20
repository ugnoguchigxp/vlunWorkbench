import { MoreHorizontal, Trash2 } from "lucide-react";
import type { ScanRun } from "../../../api";
import { Menu, MenuItem } from "../../../components/menu";

export function ScanActionsMenu({
	scan,
	onDelete,
}: {
	scan: ScanRun;
	onDelete: (scan: ScanRun) => void;
}) {
	const active = scan.status === "queued" || scan.status === "running";
	return (
		<Menu
			label={`${scan.profile} のスキャン履歴を操作`}
			trigger={<MoreHorizontal className="icon" aria-hidden="true" />}
		>
			<MenuItem danger disabled={active} onSelect={() => onDelete(scan)}>
				<Trash2 className="icon" aria-hidden="true" />
				{active ? "実行中は削除できません" : "履歴を削除"}
			</MenuItem>
		</Menu>
	);
}
