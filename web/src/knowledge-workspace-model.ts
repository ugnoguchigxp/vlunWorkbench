import type { SourceTreeResponse } from "./api";

export const dragMimeType = "application/x-vuln-workbench-knowledge-node";
export const initialBody = "# New Page\n\nWrite your documentation here.\n";

export type ExplorerNode =
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

export type DragPayload =
	| { kind: "folder"; path: string }
	| { kind: "page"; slug: string; path: string };

export const emptyTree: SourceTreeResponse = { items: [], folders: [] };

export const trimSlug = (slug: string): string =>
	slug
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "")
		.replace(/\/+/g, "/")
		.trim();

export const joinSlug = (...parts: Array<string | null | undefined>): string =>
	trimSlug(
		parts.filter((part): part is string => Boolean(part?.trim())).join("/"),
	);

export const parentPathOf = (value: string): string => {
	const normalized = trimSlug(value);
	if (!normalized.includes("/")) return "";
	return normalized.split("/").slice(0, -1).join("/");
};

export const baseNameOf = (value: string, fallback = "index"): string => {
	const normalized = trimSlug(value);
	if (!normalized) return fallback;
	return normalized.split("/").at(-1) ?? fallback;
};

export const pageParentFromPath = (filePath: string): string =>
	parentPathOf(filePath);

export const pageNameFromPath = (filePath: string): string => {
	const name = filePath.split("/").at(-1) ?? filePath;
	return name.replace(/\.md$/i, "") || "index";
};

export const resolveSiblingPath = (
	currentPath: string,
	input: string,
): string => {
	const normalizedInput = trimSlug(input);
	if (normalizedInput.includes("/")) return normalizedInput;
	return joinSlug(parentPathOf(currentPath), normalizedInput);
};

export const shortCommit = (commit: string): string => commit.slice(0, 7);

export const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
};

export const normalizeTags = (value: unknown): string[] => {
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

export const tagsInputFromMeta = (meta: Record<string, unknown>): string =>
	normalizeTags(meta.tags).join(", ");

export const applyTagsToMeta = (
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

export const sortExplorerNodes = (nodes: ExplorerNode[]): ExplorerNode[] =>
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

export const buildExplorerTree = (
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

export const collectFolderPaths = (nodes: ExplorerNode[]): string[] =>
	nodes.flatMap((node) =>
		node.kind === "folder"
			? [node.path, ...collectFolderPaths(node.children)]
			: [],
	);

export const folderAncestors = (folderPath: string): string[] => {
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
