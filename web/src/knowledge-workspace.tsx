import {
	ChevronDown,
	ChevronRight,
	Edit2,
	Eye,
	FilePlus2,
	FileText,
	Folder,
	FolderInput,
	FolderOpen,
	FolderPlus,
	GitBranch,
	Home,
	Pencil,
	RefreshCw,
	Save,
	Search,
	Trash2,
} from "lucide-react";
import mermaid from "mermaid";
import { MarkdownEditor } from "markdown-wysiwyg-editor";
import type { DragEvent, ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";
import {
	createSourceFolder,
	createSourcePage,
	deleteSourceFolder,
	deleteSourcePage,
	fetchSourceDiff,
	fetchSourceHealth,
	fetchSourceHistory,
	fetchSourcePage,
	fetchSourceTree,
	renameSourceFolder,
	runSourceReindex,
	searchSourcePages,
	type SourceHealth,
	type SourceHistoryItem,
	type SourceTreeResponse,
	updateSourcePage,
} from "./api";
import { IconButton, SelectInput, TextInput } from "./ui";

mermaid.initialize({ startOnLoad: false });

const dragMimeType = "application/x-hono-standard-rag-wiki-node";
const initialBody = "# New Page\n\nWrite your documentation here.\n";

type ExplorerNode =
	| {
			kind: "folder";
			id: string;
			path: string;
			name: string;
			children: ExplorerNode[];
	  }
	| {
			kind: "page";
			id: string;
			slug: string;
			path: string;
			name: string;
			title: string;
			children: [];
	  };

type DragPayload =
	| { kind: "folder"; path: string }
	| { kind: "page"; slug: string; path: string };

const emptyTree: SourceTreeResponse = { items: [], folders: [] };

const trimSlug = (slug: string): string =>
	slug
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "")
		.replace(/\/+/g, "/")
		.trim();

const joinSlug = (...parts: Array<string | null | undefined>): string =>
	trimSlug(
		parts.filter((part): part is string => Boolean(part?.trim())).join("/"),
	);

const parentPathOf = (value: string): string => {
	const normalized = trimSlug(value);
	if (!normalized.includes("/")) return "";
	return normalized.split("/").slice(0, -1).join("/");
};

const baseNameOf = (value: string, fallback = "index"): string => {
	const normalized = trimSlug(value);
	if (!normalized) return fallback;
	return normalized.split("/").at(-1) ?? fallback;
};

const pageParentFromPath = (filePath: string): string => parentPathOf(filePath);

const pageNameFromPath = (filePath: string): string => {
	const name = filePath.split("/").at(-1) ?? filePath;
	return name.replace(/\.md$/i, "") || "index";
};

const resolveSiblingPath = (currentPath: string, input: string): string => {
	const normalizedInput = trimSlug(input);
	if (normalizedInput.includes("/")) return normalizedInput;
	return joinSlug(parentPathOf(currentPath), normalizedInput);
};

const shortCommit = (commit: string): string => commit.slice(0, 7);

const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
};

const normalizeTags = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return [
			...new Set(value.map((item) => String(item).trim()).filter(Boolean)),
		];
	}
	if (typeof value === "string") {
		return [
			...new Set(
				value
					.split(/[\n,]/)
					.map((item) => item.trim())
					.filter(Boolean),
			),
		];
	}
	return [];
};

const tagsInputFromMeta = (meta: Record<string, unknown>): string =>
	normalizeTags(meta.tags).join(", ");

const applyTagsToMeta = (
	meta: Record<string, unknown>,
	tagsInput: string,
): Record<string, unknown> => {
	const tags = normalizeTags(tagsInput);
	const next = { ...meta };
	if (tags.length === 0) {
		delete next.tags;
		return next;
	}
	next.tags = tags;
	return next;
};

const sortExplorerNodes = (nodes: ExplorerNode[]): ExplorerNode[] =>
	nodes
		.map((node) =>
			node.kind === "folder"
				? { ...node, children: sortExplorerNodes(node.children) }
				: node,
		)
		.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

const buildExplorerTree = (
	pages: SourceTreeResponse["items"],
	folders: SourceTreeResponse["folders"],
): ExplorerNode[] => {
	const rootNodes: ExplorerNode[] = [];
	const folderMap = new Map<
		string,
		Extract<ExplorerNode, { kind: "folder" }>
	>();

	const ensureFolder = (
		folderPath: string,
	): Extract<ExplorerNode, { kind: "folder" }> => {
		const normalized = trimSlug(folderPath);
		const existing = folderMap.get(normalized);
		if (existing) return existing;

		const node: Extract<ExplorerNode, { kind: "folder" }> = {
			kind: "folder",
			id: `folder:${normalized}`,
			path: normalized,
			name: baseNameOf(normalized, "pages"),
			children: [],
		};
		folderMap.set(normalized, node);

		const parentPath = parentPathOf(normalized);
		if (parentPath) {
			ensureFolder(parentPath).children.push(node);
		} else {
			rootNodes.push(node);
		}
		return node;
	};

	for (const folder of folders) {
		ensureFolder(folder.path);
	}

	for (const page of pages) {
		const parentPath = pageParentFromPath(page.path);
		const pageNode: ExplorerNode = {
			kind: "page",
			id: `page:${page.path}`,
			slug: page.slug,
			path: page.path,
			name: pageNameFromPath(page.path),
			title: page.title,
			children: [],
		};
		if (parentPath) {
			ensureFolder(parentPath).children.push(pageNode);
		} else {
			rootNodes.push(pageNode);
		}
	}

	return sortExplorerNodes(rootNodes);
};

const collectFolderPaths = (nodes: ExplorerNode[]): string[] =>
	nodes.flatMap((node) =>
		node.kind === "folder"
			? [node.path, ...collectFolderPaths(node.children)]
			: [],
	);

const folderAncestors = (folderPath: string): string[] => {
	const normalized = trimSlug(folderPath);
	if (!normalized) return [];
	const segments = normalized.split("/").filter(Boolean);
	const results: string[] = [];
	for (let index = 0; index < segments.length; index += 1) {
		const candidate = segments.slice(0, index + 1).join("/");
		results.push(candidate);
	}
	return results;
};

type KnowledgeWorkspaceProps = {
	requestedSlug?: string | null;
	requestedAt?: number;
};

export function KnowledgeWorkspace({
	requestedSlug = null,
	requestedAt = 0,
}: KnowledgeWorkspaceProps) {
	const [loading, setLoading] = useState(false);
	const [mutating, setMutating] = useState(false);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [statusText, setStatusText] = useState<string | null>(null);

	const [sourceTree, setSourceTree] = useState<SourceTreeResponse>(emptyTree);
	const [sourceHealth, setSourceHealth] = useState<SourceHealth | null>(null);
	const [sourceSearchQuery, setSourceSearchQuery] = useState("");
	const [sourceSearchHits, setSourceSearchHits] = useState<
		Array<{ slug: string; excerpt: string }>
	>([]);

	const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
	const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(
		null,
	);
	const [selectedPagePath, setSelectedPagePath] = useState<string>("");
	const [isCreating, setIsCreating] = useState(false);
	const [mode, setMode] = useState<"view" | "edit">("view");
	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
		() => new Set(),
	);
	const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

	const [draftSlug, setDraftSlug] = useState("");
	const [draftTitle, setDraftTitle] = useState("");
	const [draftTags, setDraftTags] = useState("");
	const [draftBody, setDraftBody] = useState(initialBody);
	const [draftMeta, setDraftMeta] = useState<Record<string, unknown>>({});

	const [sourceHistory, setSourceHistory] = useState<SourceHistoryItem[]>([]);
	const [diffFrom, setDiffFrom] = useState("");
	const [diffTo, setDiffTo] = useState("");
	const [sourceDiff, setSourceDiff] = useState("");

	const explorerNodes = useMemo(
		() => buildExplorerTree(sourceTree.items, sourceTree.folders),
		[sourceTree.folders, sourceTree.items],
	);
	const allFolderPaths = useMemo(
		() => collectFolderPaths(explorerNodes),
		[explorerNodes],
	);
	const existingSlugs = useMemo(
		() => new Set(sourceTree.items.map((item) => item.slug)),
		[sourceTree.items],
	);

	const busy = mutating;

	const clearDraft = () => {
		setDraftSlug("");
		setDraftTitle("");
		setDraftTags("");
		setDraftBody(initialBody);
		setDraftMeta({});
	};

	const withMutating = async (task: () => Promise<void>) => {
		setMutating(true);
		setErrorText(null);
		try {
			await task();
		} catch (error) {
			setErrorText(
				error instanceof Error ? error.message : "Knowledge operation failed.",
			);
		} finally {
			setMutating(false);
		}
	};

	const loadTreeAndHealth = async () => {
		setLoading(true);
		try {
			const tree = await refreshTree();
			if (!isCreating && selectedSlug === null && tree.items[0]) {
				setSelectedSlug(tree.items[0].slug);
			}
		} catch (error) {
			setErrorText(
				error instanceof Error
					? error.message
					: "Failed to load knowledge metadata.",
			);
		} finally {
			setLoading(false);
		}
	};

	const refreshTree = async () => {
		const [tree, health] = await Promise.all([
			fetchSourceTree(),
			fetchSourceHealth(),
		]);
		setSourceTree(tree);
		setSourceHealth(health);
		return tree;
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: initial load
	useEffect(() => {
		void loadTreeAndHealth();
	}, []);

	useEffect(() => {
		if (allFolderPaths.length === 0) return;
		setExpandedFolders((current) => {
			if (current.size > 0) return current;
			return new Set(allFolderPaths);
		});
	}, [allFolderPaths]);

	useEffect(() => {
		if (sourceSearchQuery.trim() !== "") return;
		setSourceSearchHits([]);
	}, [sourceSearchQuery]);

	useEffect(() => {
		if (requestedAt === 0) return;
		if (!requestedSlug) return;
		if (!existingSlugs.has(requestedSlug)) return;
		const selectedItem = sourceTree.items.find(
			(item) => item.slug === requestedSlug,
		);
		const selectedPath = selectedItem?.path ?? "";
		const folderPath = parentPathOf(selectedPath);
		setIsCreating(false);
		setMode("view");
		setSelectedSlug(requestedSlug);
		setSelectedFolderPath(folderPath || null);
		setSourceSearchQuery("");
		setSourceSearchHits([]);
		setDiffFrom("");
		setDiffTo("");
		setSourceDiff("");
		if (folderPath) {
			setExpandedFolders((current) => {
				const next = new Set(current);
				for (const path of folderAncestors(folderPath)) {
					next.add(path);
				}
				return next;
			});
		}
		setStatusText(`Selected: ${requestedSlug}`);
	}, [existingSlugs, requestedAt, requestedSlug, sourceTree.items]);

	useEffect(() => {
		if (isCreating) return;
		if (selectedSlug !== null) return;
		if (!sourceTree.items[0]) return;
		setSelectedSlug(sourceTree.items[0].slug);
	}, [isCreating, selectedSlug, sourceTree.items]);

	useEffect(() => {
		if (isCreating || selectedSlug === null) {
			setSourceHistory([]);
			setSourceDiff("");
			setSelectedPagePath("");
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				setErrorText(null);
				const [page, history] = await Promise.all([
					fetchSourcePage(selectedSlug),
					fetchSourceHistory(selectedSlug),
				]);
				if (cancelled) return;
				setDraftSlug(page.slug);
				setDraftTitle(page.title);
				setDraftTags(tagsInputFromMeta(page.meta));
				setDraftBody(page.body);
				setDraftMeta(page.meta);
				setSelectedPagePath(page.path);
				setSourceHistory(history);
			} catch (error) {
				if (cancelled) return;
				setErrorText(
					error instanceof Error ? error.message : "Failed to load page.",
				);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isCreating, selectedSlug]);

	useEffect(() => {
		if (sourceHistory.length < 2) return;
		const latest = sourceHistory[0];
		const previous = sourceHistory[1];
		if (!latest || !previous) return;
		if (!diffTo) setDiffTo(latest.commit);
		if (!diffFrom) setDiffFrom(previous.commit);
	}, [diffFrom, diffTo, sourceHistory]);

	useEffect(() => {
		if (isCreating || selectedSlug === null || !diffFrom || !diffTo) {
			setSourceDiff("");
			return;
		}
		let cancelled = false;
		void (async () => {
			try {
				const diff = await fetchSourceDiff(selectedSlug, diffFrom, diffTo);
				if (!cancelled) setSourceDiff(diff);
			} catch (error) {
				if (cancelled) return;
				setErrorText(
					error instanceof Error ? error.message : "Failed to load diff.",
				);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [diffFrom, diffTo, isCreating, selectedSlug]);

	const nextDraftSlug = (folderPath: string): string => {
		const baseSlug = joinSlug(folderPath, "untitled");
		if (!existingSlugs.has(baseSlug)) return baseSlug;
		for (let index = 2; index < 100; index += 1) {
			const candidate = joinSlug(folderPath, `untitled-${index}`);
			if (!existingSlugs.has(candidate)) return candidate;
		}
		return joinSlug(folderPath, `untitled-${Date.now()}`);
	};

	const targetFolderForNewItem = (): string =>
		selectedFolderPath ?? parentPathOf(selectedSlug ?? "");

	const startCreate = (folderPath = targetFolderForNewItem()) => {
		const nextSlug = nextDraftSlug(folderPath);
		setIsCreating(true);
		setMode("edit");
		setSelectedSlug(null);
		setSelectedFolderPath(folderPath || null);
		setSelectedPagePath("");
		setDraftSlug(nextSlug);
		setDraftTitle("Untitled");
		setDraftTags("");
		setDraftBody(initialBody);
		setDraftMeta({});
		setDiffFrom("");
		setDiffTo("");
		setSourceDiff("");
		setStatusText(`Create page: ${nextSlug || "home"}`);
	};

	const selectExistingPage = (slug: string) => {
		setIsCreating(false);
		setMode("view");
		setSelectedSlug(slug);
		setSelectedFolderPath(null);
		setDiffFrom("");
		setDiffTo("");
		setSourceDiff("");
		setStatusText(`Selected: ${slug || "home"}`);
	};

	const selectFolder = (folderPath: string) => {
		setSelectedFolderPath(folderPath);
		setStatusText(`Folder: ${folderPath}`);
	};

	const pagePayloadForSlug = async (slug: string) => {
		if (slug === selectedSlug && !isCreating) {
			return {
				title: draftTitle.trim() || baseNameOf(slug, "Home"),
				body: draftBody,
				meta: draftMeta,
			};
		}
		const page = await fetchSourcePage(slug);
		return {
			title: page.title,
			body: page.body,
			meta: page.meta,
		};
	};

	const renamePageToSlug = async (
		slug: string,
		targetSlug: string,
		message: string,
	) => {
		const normalizedTarget = trimSlug(targetSlug);
		if (normalizedTarget === slug) {
			setStatusText("Page slug is unchanged.");
			return;
		}
		const payload = await pagePayloadForSlug(slug);
		await withMutating(async () => {
			const result = await updateSourcePage(slug, {
				slug: normalizedTarget,
				title: payload.title,
				body: payload.body,
				meta: payload.meta,
				commitMessage: message,
			});
			const tree = await refreshTree();
			setIsCreating(false);
			const nextSlug = result.slug ?? normalizedTarget;
			setSelectedSlug(nextSlug);
			if (!tree.items.find((item) => item.slug === nextSlug)) {
				setSelectedSlug(tree.items[0]?.slug ?? null);
			}
			setStatusText(`Page renamed: ${slug || "home"} -> ${nextSlug || "home"}`);
		});
	};

	const movePageToFolder = async (slug: string, folderPath: string) => {
		const targetSlug = joinSlug(folderPath, baseNameOf(slug));
		await renamePageToSlug(
			slug,
			targetSlug,
			`docs(page): move ${slug || "home"} to ${folderPath || "root"}`,
		);
	};

	const moveFolderToFolder = async (
		folderPath: string,
		targetFolderPath: string,
	) => {
		if (
			targetFolderPath === folderPath ||
			targetFolderPath.startsWith(`${folderPath}/`)
		) {
			setStatusText("Cannot move a folder into itself.");
			return;
		}
		const targetPath = joinSlug(targetFolderPath, baseNameOf(folderPath));
		await renameFolderToPath(folderPath, targetPath);
	};

	const renameFolderToPath = async (folderPath: string, targetPath: string) => {
		if (targetPath === folderPath) {
			setStatusText("Folder path is unchanged.");
			return;
		}
		await withMutating(async () => {
			const result = await renameSourceFolder(folderPath, targetPath);
			await refreshTree();
			const nextPath = result.path ?? targetPath;
			setSelectedFolderPath(nextPath);
			const activeMove = result.movedPages?.find(
				(move) => move.from === selectedSlug,
			);
			if (activeMove) setSelectedSlug(activeMove.to);
			setExpandedFolders((current) => {
				const next = new Set(current);
				next.add(nextPath);
				next.add(parentPathOf(nextPath));
				return next;
			});
			setStatusText(`Folder renamed: ${folderPath} -> ${nextPath}`);
		});
	};

	const handleSave = async () => {
		const normalizedSlug = trimSlug(draftSlug);
		if (!draftTitle.trim()) {
			setErrorText("Title is required.");
			return;
		}

		if (isCreating) {
			await withMutating(async () => {
				const result = await createSourcePage({
					slug: normalizedSlug,
					title: draftTitle.trim(),
					body: draftBody,
					meta: draftMeta,
				});
				await refreshTree();
				const nextSlug = result.slug ?? normalizedSlug;
				setIsCreating(false);
				setSelectedFolderPath(null);
				setSelectedSlug(nextSlug);
				setStatusText(`Created: ${nextSlug || "home"}`);
			});
			return;
		}

		if (selectedSlug === null) {
			setErrorText("No page selected.");
			return;
		}

		await withMutating(async () => {
			const result = await updateSourcePage(selectedSlug, {
				slug: normalizedSlug,
				title: draftTitle.trim(),
				body: draftBody,
				meta: draftMeta,
			});
			await refreshTree();
			const nextSlug = result.slug ?? normalizedSlug;
			setSelectedSlug(nextSlug);
			setStatusText(`Saved: ${nextSlug || "home"}`);
		});
	};

	const deletePageBySlug = async (slug: string) => {
		const confirmed = window.confirm(`Delete page: ${slug || "home"}?`);
		if (!confirmed) return;
		await withMutating(async () => {
			await deleteSourcePage(slug);
			const tree = await refreshTree();
			if (selectedSlug === slug) {
				setSelectedSlug(tree.items[0]?.slug ?? null);
				setSelectedFolderPath(null);
			}
			setStatusText(`Deleted: ${slug || "home"}`);
		});
	};

	const deleteFolderByPath = async (folderPath: string) => {
		const confirmed = window.confirm(
			`Delete folder recursively: ${folderPath}?\nAll pages inside it will be removed.`,
		);
		if (!confirmed) return;
		await withMutating(async () => {
			const result = await deleteSourceFolder(folderPath);
			const tree = await refreshTree();
			if (selectedSlug && result.deletedSlugs?.includes(selectedSlug)) {
				setSelectedSlug(tree.items[0]?.slug ?? null);
			}
			setSelectedFolderPath(null);
			setStatusText(`Folder deleted: ${result.path ?? folderPath}`);
		});
	};

	const handleDelete = async () => {
		if (selectedFolderPath) {
			await deleteFolderByPath(selectedFolderPath);
			return;
		}

		if (isCreating) {
			setIsCreating(false);
			clearDraft();
			setStatusText("Creation canceled.");
			return;
		}

		if (selectedSlug === null) {
			setErrorText("No page selected.");
			return;
		}

		await deletePageBySlug(selectedSlug);
	};

	const promptCreateFolder = async (parentPath = targetFolderForNewItem()) => {
		const suggested = joinSlug(parentPath, "new-folder");
		const input = window.prompt("Folder name or path", suggested);
		if (input === null) return;
		const folderPath = input.includes("/")
			? trimSlug(input)
			: joinSlug(parentPath, input);
		if (!folderPath) {
			setErrorText("Folder path is required.");
			return;
		}
		await withMutating(async () => {
			const result = await createSourceFolder(folderPath);
			await refreshTree();
			const createdPath = result.path ?? folderPath;
			setSelectedFolderPath(createdPath);
			setExpandedFolders((current) => {
				const next = new Set(current);
				next.add(createdPath);
				next.add(parentPathOf(createdPath));
				return next;
			});
			setStatusText(`Folder created: ${createdPath}`);
		});
	};

	const promptRenameFolder = async (folderPath: string) => {
		const input = window.prompt("New folder name or path", folderPath);
		if (input === null) return;
		const targetPath = resolveSiblingPath(folderPath, input);
		if (!targetPath || targetPath === folderPath) {
			setStatusText("Folder path is unchanged.");
			return;
		}
		await renameFolderToPath(folderPath, targetPath);
	};

	const promptRenamePage = async (slug: string) => {
		const input = window.prompt("New page name or slug", slug || "index");
		if (input === null) return;
		const targetSlug = resolveSiblingPath(slug, input === "index" ? "" : input);
		await renamePageToSlug(
			slug,
			targetSlug,
			`docs(page): rename ${slug || "home"}`,
		);
	};

	const handleSearchSource = async () => {
		const query = sourceSearchQuery.trim();
		if (!query) {
			setSourceSearchHits([]);
			return;
		}
		await withMutating(async () => {
			const hits = await searchSourcePages(query);
			setSourceSearchHits(hits);
		});
	};

	const parseDragPayload = (event: DragEvent): DragPayload | null => {
		const raw = event.dataTransfer.getData(dragMimeType);
		if (!raw) return null;
		try {
			return JSON.parse(raw) as DragPayload;
		} catch {
			return null;
		}
	};

	const handleDragStart = (event: DragEvent, payload: DragPayload) => {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData(dragMimeType, JSON.stringify(payload));
	};

	const handleDragOverFolder = (event: DragEvent, folderPath: string) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		setDragOverFolder(folderPath);
	};

	const handleDropOnFolder = async (event: DragEvent, folderPath: string) => {
		event.preventDefault();
		setDragOverFolder(null);
		const payload = parseDragPayload(event);
		if (!payload) return;
		if (payload.kind === "page") {
			await movePageToFolder(payload.slug, folderPath);
			return;
		}
		await moveFolderToFolder(payload.path, folderPath);
	};

	const toggleFolder = (folderPath: string) => {
		setExpandedFolders((current) => {
			const next = new Set(current);
			if (next.has(folderPath)) next.delete(folderPath);
			else next.add(folderPath);
			return next;
		});
	};

	const renderExplorerNode = (node: ExplorerNode, depth = 0): ReactElement => {
		if (node.kind === "folder") {
			const isExpanded = expandedFolders.has(node.path);
			const isSelected = selectedFolderPath === node.path;
			const isDropTarget = dragOverFolder === node.path;
			return (
				<div key={node.id}>
					<div
						role="treeitem"
						tabIndex={0}
						aria-expanded={isExpanded}
						draggable
						onDragStart={(event) =>
							handleDragStart(event, { kind: "folder", path: node.path })
						}
						onDragOver={(event) => handleDragOverFolder(event, node.path)}
						onDragLeave={() => setDragOverFolder(null)}
						onDrop={(event) => void handleDropOnFolder(event, node.path)}
						className={`explorer-row folder ${isSelected ? "selected" : ""} ${isDropTarget ? "drop-target" : ""}`}
						style={{ paddingLeft: `${depth * 14 + 6}px` }}
					>
						<IconButton
							type="button"
							className="icon-btn inline small"
							onClick={() => toggleFolder(node.path)}
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
							onClick={() => selectFolder(node.path)}
						>
							{isExpanded ? (
								<FolderOpen className="icon" />
							) : (
								<Folder className="icon" />
							)}
							<span>{node.name}</span>
						</button>
						<div className="explorer-inline-actions">
							<IconButton
								type="button"
								className="icon-btn inline"
								title="New page"
								onClick={() => startCreate(node.path)}
								disabled={busy}
							>
								<FilePlus2 className="icon" />
							</IconButton>
							<IconButton
								type="button"
								className="icon-btn inline"
								title="New folder"
								onClick={() => void promptCreateFolder(node.path)}
								disabled={busy}
							>
								<FolderPlus className="icon" />
							</IconButton>
							<IconButton
								type="button"
								className="icon-btn inline"
								title="Rename folder"
								onClick={() => void promptRenameFolder(node.path)}
								disabled={busy}
							>
								<Pencil className="icon" />
							</IconButton>
							<IconButton
								type="button"
								className="icon-btn inline danger"
								title="Delete folder"
								onClick={() => void deleteFolderByPath(node.path)}
								disabled={busy}
							>
								<Trash2 className="icon" />
							</IconButton>
						</div>
					</div>
					{isExpanded
						? node.children.map((child) => renderExplorerNode(child, depth + 1))
						: null}
				</div>
			);
		}

		const isActive = !isCreating && node.slug === selectedSlug;
		return (
			<div
				role="treeitem"
				tabIndex={0}
				key={node.id}
				draggable
				onDragStart={(event) =>
					handleDragStart(event, {
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
					onClick={() => selectExistingPage(node.slug)}
				>
					{node.slug === "" ? (
						<Home className="icon" />
					) : (
						<FileText className="icon" />
					)}
					<span>{node.name}</span>
				</button>
				<div className="explorer-inline-actions">
					<IconButton
						type="button"
						className="icon-btn inline"
						title="Rename page"
						onClick={() => void promptRenamePage(node.slug)}
						disabled={busy}
					>
						<Pencil className="icon" />
					</IconButton>
					<IconButton
						type="button"
						className="icon-btn inline danger"
						title="Delete page"
						onClick={() => void deletePageBySlug(node.slug)}
						disabled={busy}
					>
						<Trash2 className="icon" />
					</IconButton>
				</div>
			</div>
		);
	};

	return (
		<main className="layout columns-3 knowledge-layout">
			<section className="panel">
				<div className="panel-header">
					<h2>Explorer</h2>
					<div className="actions">
						<IconButton
							type="button"
							title="New page"
							onClick={() => startCreate()}
							disabled={busy}
						>
							<FilePlus2 className="icon" />
						</IconButton>
						<IconButton
							type="button"
							title="New folder"
							onClick={() => void promptCreateFolder()}
							disabled={busy}
						>
							<FolderPlus className="icon" />
						</IconButton>
					</div>
				</div>
				<div className="search-row">
					<TextInput
						value={sourceSearchQuery}
						onChange={(event) => setSourceSearchQuery(event.target.value)}
						placeholder="Search pages"
					/>
					<IconButton
						type="button"
						title="Search pages"
						onClick={handleSearchSource}
						disabled={busy}
					>
						<Search className="icon" />
					</IconButton>
				</div>
				<button
					type="button"
					className={`drop-root ${dragOverFolder === "" ? "active" : ""}`}
					onDragOver={(event) => handleDragOverFolder(event, "")}
					onDragLeave={() => setDragOverFolder(null)}
					onDrop={(event) => void handleDropOnFolder(event, "")}
					onClick={() => selectExistingPage("")}
				>
					<FolderInput className="icon" />
					<span>Drop to root</span>
				</button>
				<div className="explorer-tree">
					{sourceSearchHits.length > 0
						? sourceSearchHits.map((item) => (
								<button
									key={`search-${item.slug}`}
									type="button"
									className={
										selectedSlug === item.slug
											? "list-item active"
											: "list-item"
									}
									onClick={() => selectExistingPage(item.slug)}
								>
									<div>{item.slug || "home"}</div>
									<small>{item.excerpt}</small>
								</button>
							))
						: explorerNodes.map((node) => renderExplorerNode(node))}
					{loading ? <div className="tree-info">Loading tree...</div> : null}
					{!loading &&
					sourceSearchHits.length === 0 &&
					explorerNodes.length === 0 ? (
						<div className="tree-info">No pages yet.</div>
					) : null}
				</div>
			</section>

			<section className="panel">
				<div className="panel-header">
					<h2>{mode === "edit" ? "Edit" : "View"} Page</h2>
					<div className="actions">
						<IconButton
							type="button"
							title="Edit"
							onClick={() => setMode("edit")}
							disabled={mode === "edit"}
						>
							<Edit2 className="icon" />
						</IconButton>
						<IconButton
							type="button"
							title="View"
							onClick={() => setMode("view")}
							disabled={mode === "view"}
						>
							<Eye className="icon" />
						</IconButton>
						<IconButton
							type="button"
							title="Save"
							onClick={handleSave}
							disabled={busy}
						>
							<Save className="icon" />
						</IconButton>
						<IconButton
							type="button"
							title="Delete selected"
							onClick={() => void handleDelete()}
							disabled={busy}
						>
							<Trash2 className="icon" />
						</IconButton>
						<IconButton
							type="button"
							title="Reindex"
							onClick={() =>
								void withMutating(async () => {
									const result = await runSourceReindex();
									await refreshTree();
									setStatusText(
										`Reindex completed: imported=${result.importedFiles}, skipped=${result.skippedFiles}, removed=${result.removedSources}`,
									);
								})
							}
							disabled={busy}
						>
							<RefreshCw className="icon" />
						</IconButton>
					</div>
				</div>

				<div className="editor-fields">
					<label htmlFor="knowledge-slug">
						Slug
						<TextInput
							id="knowledge-slug"
							value={draftSlug}
							onChange={(event) => setDraftSlug(event.target.value)}
						/>
					</label>
					<label htmlFor="knowledge-title">
						Title
						<TextInput
							id="knowledge-title"
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
						/>
					</label>
					<label htmlFor="knowledge-tags" className="span-2">
						Tags (comma separated)
						<TextInput
							id="knowledge-tags"
							value={draftTags}
							onChange={(event) => {
								const value = event.target.value;
								setDraftTags(value);
								setDraftMeta((prev) => applyTagsToMeta(prev, value));
							}}
							placeholder="hono, rag, postgres"
						/>
					</label>
				</div>

				{errorText ? (
					<div className="section-status error">{errorText}</div>
				) : null}
				{statusText ? <div className="section-status">{statusText}</div> : null}

				<div className="knowledge-editor">
					<MarkdownEditor
						value={draftBody}
						onChange={setDraftBody}
						editable={mode === "edit"}
						enableMermaid={true}
						mermaidLib={mermaid}
						toolbarMode={mode === "edit" ? "fixed" : "hidden"}
						enableVerticalScroll
						className="wysiwyg-editor"
					/>
				</div>
			</section>

			<section className="panel">
				<div className="panel-header">
					<h2>Git / History / Diff</h2>
				</div>
				<div className="meta-list">
					<div>
						<GitBranch className="icon" />
						<span>{sourceHealth?.git?.branch ?? "-"}</span>
					</div>
					<div>
						<Home className="icon" />
						<span>{sourceHealth?.git?.commit ?? "-"}</span>
					</div>
					<div>
						<FileText className="icon" />
						<span>{selectedPagePath || "-"}</span>
					</div>
				</div>
				<div className="panel-header sub">
					<h3>History</h3>
				</div>
				<div className="list compact">
					{sourceHistory.map((item) => (
						<button
							key={item.commit}
							type="button"
							className={`list-item ${diffTo === item.commit ? "active" : ""}`}
							onClick={() => setDiffTo(item.commit)}
						>
							<div>{item.message}</div>
							<small>
								{shortCommit(item.commit)} {item.author}{" "}
								{formatDateTime(item.date)}
							</small>
						</button>
					))}
					{sourceHistory.length === 0 ? (
						<div className="tree-info">No history for selected page.</div>
					) : null}
				</div>
				<div className="history-selects">
					<label htmlFor="knowledge-diff-from">
						From
						<SelectInput
							id="knowledge-diff-from"
							className="history-select"
							value={diffFrom}
							onChange={(event) => setDiffFrom(event.target.value)}
						>
							<option value="">Select commit</option>
							{sourceHistory.map((item) => (
								<option key={`from-${item.commit}`} value={item.commit}>
									{shortCommit(item.commit)} {item.message}
								</option>
							))}
						</SelectInput>
					</label>
					<label htmlFor="knowledge-diff-to">
						To
						<SelectInput
							id="knowledge-diff-to"
							className="history-select"
							value={diffTo}
							onChange={(event) => setDiffTo(event.target.value)}
						>
							<option value="">Select commit</option>
							{sourceHistory.map((item) => (
								<option key={`to-${item.commit}`} value={item.commit}>
									{shortCommit(item.commit)} {item.message}
								</option>
							))}
						</SelectInput>
					</label>
				</div>
				<div className="diff-view grow">
					<pre>
						{sourceDiff ||
							"Select two commits from history to view diff output."}
					</pre>
				</div>
			</section>
		</main>
	);
}
