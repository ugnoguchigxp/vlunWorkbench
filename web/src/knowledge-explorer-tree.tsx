import {
	ChevronDown,
	ChevronRight,
	FilePlus2,
	FileText,
	Folder,
	FolderOpen,
	FolderPlus,
	Home,
	Pencil,
	Trash2,
} from "lucide-react";
import type { DragEvent, ReactElement } from "react";
import type { DragPayload, ExplorerNode } from "./knowledge-workspace-model";
import { IconButton } from "./ui";

type KnowledgeExplorerTreeProps = {
	nodes: ExplorerNode[];
	canManage: boolean;
	busy: boolean;
	expandedFolders: Set<string>;
	selectedFolderPath: string | null;
	dragOverFolder: string | null;
	isCreating: boolean;
	selectedSlug: string | null;
	setDragOverFolder: (path: string | null) => void;
	handleDragStart: (event: DragEvent, payload: DragPayload) => void;
	handleDragOverFolder: (event: DragEvent, path: string) => void;
	handleDropOnFolder: (event: DragEvent, path: string) => Promise<void>;
	toggleFolder: (path: string) => void;
	selectFolder: (path: string) => void;
	startCreate: (path?: string) => void;
	promptCreateFolder: (path?: string) => Promise<void>;
	promptRenameFolder: (path: string) => Promise<void>;
	deleteFolderByPath: (path: string) => Promise<void>;
	selectExistingPage: (slug: string) => void;
	promptRenamePage: (slug: string) => Promise<void>;
	deletePageBySlug: (slug: string) => Promise<void>;
};

export function KnowledgeExplorerTree(props: KnowledgeExplorerTreeProps) {
	const renderNode = (node: ExplorerNode, depth = 0): ReactElement => {
		if (node.kind === "folder") {
			const isExpanded = props.expandedFolders.has(node.path);
			const isSelected = props.selectedFolderPath === node.path;
			const isDropTarget = props.dragOverFolder === node.path;
			return (
				<div key={node.id}>
					<div
						role="treeitem"
						tabIndex={0}
						aria-expanded={isExpanded}
						draggable={props.canManage}
						onDragStart={(event) =>
							props.handleDragStart(event, {
								kind: "folder",
								path: node.path,
							})
						}
						onDragOver={(event) => props.handleDragOverFolder(event, node.path)}
						onDragLeave={() => props.setDragOverFolder(null)}
						onDrop={(event) => void props.handleDropOnFolder(event, node.path)}
						className={`explorer-row folder ${isSelected ? "selected" : ""} ${isDropTarget ? "drop-target" : ""}`}
						style={{ paddingLeft: `${depth * 14 + 6}px` }}
					>
						<IconButton
							type="button"
							className="icon-btn inline small"
							onClick={() => props.toggleFolder(node.path)}
							title={isExpanded ? "Collapse folder" : "Expand folder"}
						>
							{isExpanded ? (
								<ChevronDown className="icon" />
							) : (
								<ChevronRight className="icon" />
							)}
						</IconButton>
						<button
							type="button"
							className="explorer-main-btn"
							title={node.path}
							onClick={() => props.selectFolder(node.path)}
						>
							{isExpanded ? (
								<FolderOpen className="icon" />
							) : (
								<Folder className="icon" />
							)}
							<span>{node.name}</span>
						</button>
						{props.canManage ? (
							<div className="explorer-inline-actions">
								<IconButton
									type="button"
									className="icon-btn inline"
									title="New page"
									onClick={() => props.startCreate(node.path)}
									disabled={props.busy}
								>
									<FilePlus2 className="icon" />
								</IconButton>
								<IconButton
									type="button"
									className="icon-btn inline"
									title="New folder"
									onClick={() => void props.promptCreateFolder(node.path)}
									disabled={props.busy}
								>
									<FolderPlus className="icon" />
								</IconButton>
								<IconButton
									type="button"
									className="icon-btn inline"
									title="Rename folder"
									onClick={() => void props.promptRenameFolder(node.path)}
									disabled={props.busy}
								>
									<Pencil className="icon" />
								</IconButton>
								<IconButton
									type="button"
									className="icon-btn inline danger"
									title="Delete folder"
									onClick={() => void props.deleteFolderByPath(node.path)}
									disabled={props.busy}
								>
									<Trash2 className="icon" />
								</IconButton>
							</div>
						) : null}
					</div>
					{isExpanded
						? node.children.map((child) => renderNode(child, depth + 1))
						: null}
				</div>
			);
		}

		const isActive = !props.isCreating && node.slug === props.selectedSlug;
		return (
			<div
				role="treeitem"
				tabIndex={0}
				key={node.id}
				draggable={props.canManage}
				onDragStart={(event) =>
					props.handleDragStart(event, {
						kind: "page",
						slug: node.slug,
						path: node.path,
					})
				}
				className={`explorer-row page ${isActive ? "active" : ""}`}
				style={{ paddingLeft: `${depth * 14 + 31}px` }}
			>
				<button
					type="button"
					className="explorer-main-btn"
					title={`${node.title} (${node.path})`}
					onClick={() => props.selectExistingPage(node.slug)}
				>
					{node.slug === "" ? (
						<Home className="icon" />
					) : (
						<FileText className="icon" />
					)}
					<span>{node.name}</span>
				</button>
				{props.canManage ? (
					<div className="explorer-inline-actions">
						<IconButton
							type="button"
							className="icon-btn inline"
							title="Rename page"
							onClick={() => void props.promptRenamePage(node.slug)}
							disabled={props.busy}
						>
							<Pencil className="icon" />
						</IconButton>
						<IconButton
							type="button"
							className="icon-btn inline danger"
							title="Delete page"
							onClick={() => void props.deletePageBySlug(node.slug)}
							disabled={props.busy}
						>
							<Trash2 className="icon" />
						</IconButton>
					</div>
				) : null}
			</div>
		);
	};

	return <>{props.nodes.map((node) => renderNode(node))}</>;
}
