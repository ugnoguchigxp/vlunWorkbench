import { useEffect, useMemo, useState } from "react";
import {
	fetchSourceDiff,
	fetchSourceHealth,
	fetchSourceHistory,
	fetchSourcePage,
	fetchSourceTree,
	type SourceHealth,
	type SourceHistoryItem,
	type SourceTreeResponse,
} from "./api";
import {
	buildExplorerTree,
	collectFolderPaths,
	emptyTree,
	folderAncestors,
	initialBody,
	parentPathOf,
	tagsInputFromMeta,
} from "./knowledge-workspace-model";

export function useKnowledgeWorkspaceState({
	requestedSlug,
	requestedAt,
}: {
	requestedSlug: string | null;
	requestedAt: number;
}) {
	const [mutating, setMutating] = useState(false);
	const [loading, setLoading] = useState(false);
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

	return {
		loading,
		errorText,
		setErrorText,
		statusText,
		setStatusText,
		sourceTree,
		sourceHealth,
		sourceSearchQuery,
		setSourceSearchQuery,
		sourceSearchHits,
		setSourceSearchHits,
		selectedSlug,
		setSelectedSlug,
		selectedFolderPath,
		setSelectedFolderPath,
		selectedPagePath,
		setSelectedPagePath,
		isCreating,
		setIsCreating,
		mode,
		setMode,
		expandedFolders,
		setExpandedFolders,
		dragOverFolder,
		setDragOverFolder,
		draftSlug,
		setDraftSlug,
		draftTitle,
		setDraftTitle,
		draftTags,
		setDraftTags,
		draftBody,
		setDraftBody,
		draftMeta,
		setDraftMeta,
		sourceHistory,
		diffFrom,
		setDiffFrom,
		diffTo,
		setDiffTo,
		sourceDiff,
		setSourceDiff,
		explorerNodes,
		existingSlugs,
		busy,
		clearDraft,
		withMutating,
		loadTreeAndHealth,
		refreshTree,
	};
}
