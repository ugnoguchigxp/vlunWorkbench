const normalizePath = (value: string): string =>
	value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

export const DEFAULT_WIKI_CATEGORY = "tech";

export function categoryFromPageRelativePath(
	relativePath: string,
): string | null {
	const normalized = normalizePath(relativePath.trim());
	if (!normalized) return null;
	const segments = normalized.split("/").filter(Boolean);
	if (segments.length < 2) return null;
	const category = segments[0] ?? "";
	if (!category || category === "." || category === "..") {
		return null;
	}
	return category;
}

export function topLevelCategoriesFromFolderPaths(paths: string[]): string[] {
	const categories = new Set<string>();
	for (const rawPath of paths) {
		const normalized = normalizePath(rawPath.trim());
		if (!normalized) continue;
		const first = normalized.split("/")[0]?.trim();
		if (!first || first === "." || first === "..") continue;
		categories.add(first);
	}
	return [...categories].sort((a, b) => a.localeCompare(b));
}
