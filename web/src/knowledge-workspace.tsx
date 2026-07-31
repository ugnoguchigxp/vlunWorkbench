import type { DragEvent } from "react";
import {
	createSourceFolder,
	createSourcePage,
	deleteSourceFolder,
	deleteSourcePage,
	fetchSourcePage,
	renameSourceFolder,
	searchSourcePages,
	updateSourcePage,
} from "./api";
import { KnowledgeExplorerTree } from "./knowledge-explorer-tree";
import {
	baseNameOf,
	type DragPayload,
	dragMimeType,
	initialBody,
	joinSlug,
	parentPathOf,
	resolveSiblingPath,
	trimSlug,
} from "./knowledge-workspace-model";
import { KnowledgeWorkspaceView } from "./knowledge-workspace-view";
import { useKnowledgeWorkspaceState } from "./use-knowledge-workspace-state";

type KnowledgeWorkspaceProps = {
	canManage?: boolean;
	requestedSlug?: string | null;
	requestedAt?: number;
};

export function KnowledgeWorkspace({
	canManage = false,
	requestedSlug = null,
	requestedAt = 0,
}: KnowledgeWorkspaceProps) {
	const state = useKnowledgeWorkspaceState({ requestedSlug, requestedAt });
	const {
		setErrorText,
		setStatusText,
		sourceSearchQuery,
		setSourceSearchHits,
		selectedSlug,
		setSelectedSlug,
		selectedFolderPath,
		setSelectedFolderPath,
		setSelectedPagePath,
		isCreating,
		setIsCreating,
		setMode,
		expandedFolders,
		setExpandedFolders,
		dragOverFolder,
		setDragOverFolder,
		draftSlug,
		setDraftSlug,
		draftTitle,
		setDraftTitle,
		setDraftTags,
		draftBody,
		setDraftBody,
		draftMeta,
		setDraftMeta,
		setDiffFrom,
		setDiffTo,
		setSourceDiff,
		explorerNodes,
		existingSlugs,
		busy,
		clearDraft,
		withMutating,
		refreshTree,
	} = state;
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

	const explorerTree = (
		<KnowledgeExplorerTree
			nodes={explorerNodes}
			canManage={canManage}
			busy={busy}
			expandedFolders={expandedFolders}
			selectedFolderPath={selectedFolderPath}
			dragOverFolder={dragOverFolder}
			isCreating={isCreating}
			selectedSlug={selectedSlug}
			setDragOverFolder={setDragOverFolder}
			handleDragStart={handleDragStart}
			handleDragOverFolder={handleDragOverFolder}
			handleDropOnFolder={handleDropOnFolder}
			toggleFolder={toggleFolder}
			selectFolder={selectFolder}
			startCreate={startCreate}
			promptCreateFolder={promptCreateFolder}
			promptRenameFolder={promptRenameFolder}
			deleteFolderByPath={deleteFolderByPath}
			selectExistingPage={selectExistingPage}
			promptRenamePage={promptRenamePage}
			deletePageBySlug={deletePageBySlug}
		/>
	);

	return (
		<KnowledgeWorkspaceView
			state={state}
			canManage={canManage}
			explorerTree={explorerTree}
			startCreate={() => startCreate()}
			promptCreateFolder={() => promptCreateFolder()}
			handleSearchSource={handleSearchSource}
			handleDragOverFolder={handleDragOverFolder}
			handleDropOnFolder={handleDropOnFolder}
			selectExistingPage={selectExistingPage}
			handleSave={handleSave}
			handleDelete={handleDelete}
		/>
	);
}
