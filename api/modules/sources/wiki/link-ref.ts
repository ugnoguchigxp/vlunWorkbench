import { categoryFromPageRelativePath } from "./category";
import { filePathToSlug, isSafeSlug, sanitizeSlug } from "./slug";

export type WikiLinkRef = {
	pagePath: string;
	wikiSlug: string;
	wikiApiPath: string;
	wikiRawPath: string;
};

const normalizePathLike = (value: string): string =>
	value.replace(/\\/g, "/").trim().replace(/^\/+/, "").replace(/\/+/g, "/");

const stripQueryOrHash = (value: string): string =>
	value.split(/[?#]/, 1)[0] ?? "";

const isAbsolutePathLike = (value: string): boolean =>
	value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);

const hasUriScheme = (value: string): boolean =>
	/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);

const toCandidatePagePath = (value: string): string | null => {
	const raw = stripQueryOrHash(value).trim();
	if (!raw) return null;
	const normalized = normalizePathLike(raw);
	if (!normalized) return null;
	if (normalized.startsWith("pages/")) {
		return normalized.slice("pages/".length);
	}

	const marker = "/pages/";
	const index = normalized.lastIndexOf(marker);
	if (index >= 0) {
		return normalized.slice(index + marker.length);
	}
	if (isAbsolutePathLike(raw)) {
		return null;
	}
	if (hasUriScheme(raw)) {
		return null;
	}
	return normalized.endsWith(".md") ? normalized : null;
};

const encodeSlugPath = (slug: string): string =>
	slug
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");

const toMetadataRecord = (value: unknown): Record<string, unknown> | null => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
};

const toSafeWikiSlug = (value: string): string | null => {
	const normalized = sanitizeSlug(value);
	if (!normalized || !isSafeSlug(normalized)) return null;
	return normalized;
};

const buildWikiLinkRef = (slug: string, pagePath: string): WikiLinkRef => {
	const encodedSlug = encodeSlugPath(slug);
	return {
		pagePath,
		wikiSlug: slug,
		wikiApiPath: `/api/sources/pages/${encodedSlug}`,
		wikiRawPath: `/api/sources/pages/${encodedSlug}/raw`,
	};
};

const fallbackWikiSlugFromUri = (
	sourceUri: string,
	sourceCategory?: string,
): { slug: string; pagePath: string } | null => {
	const normalizedCategory = sourceCategory?.trim();
	if (
		!normalizedCategory ||
		normalizedCategory === "." ||
		normalizedCategory === ".."
	) {
		return null;
	}

	const normalizedUri = normalizePathLike(stripQueryOrHash(sourceUri));
	if (!normalizedUri.endsWith(".md")) return null;
	const filename = normalizedUri
		.split("/")
		.at(-1)
		?.replace(/\.md$/i, "")
		.trim();
	if (!filename || filename === "." || filename === "..") return null;

	const folder = normalizedCategory;
	if (!folder) return null;

	const pagePath = `${folder}/${filename}.md`;
	const slug = toSafeWikiSlug(filePathToSlug(pagePath));
	if (!slug) return null;
	return { slug, pagePath };
};

const toRelativePathCandidates = (params: {
	sourceUri: string;
	sourceMetadata?: unknown;
}): string[] => {
	const sourceMetadata = toMetadataRecord(params.sourceMetadata);
	const metadataRelativePath =
		typeof sourceMetadata?.relativePath === "string"
			? sourceMetadata.relativePath
			: null;
	const fromMetadata = metadataRelativePath
		? toCandidatePagePath(metadataRelativePath)
		: null;
	const fromUri = toCandidatePagePath(params.sourceUri);
	return [
		...new Set(
			[fromMetadata, fromUri].filter((item): item is string => !!item),
		),
	];
};

export const resolveWikiLinkRef = (params: {
	sourceUri: string;
	sourceMetadata?: unknown;
	sourceCategory?: string;
}): WikiLinkRef | null => {
	const sourceMetadata = toMetadataRecord(params.sourceMetadata);
	const metadataWikiSlug =
		typeof sourceMetadata?.wikiSlug === "string"
			? toSafeWikiSlug(sourceMetadata.wikiSlug)
			: null;
	if (metadataWikiSlug) {
		const metadataRelativePath =
			typeof sourceMetadata?.relativePath === "string"
				? toCandidatePagePath(sourceMetadata.relativePath)
				: null;
		const fallbackPagePath = metadataWikiSlug.includes("/")
			? `${metadataWikiSlug}.md`
			: `${metadataWikiSlug}/index.md`;
		return buildWikiLinkRef(
			metadataWikiSlug,
			metadataRelativePath ?? fallbackPagePath,
		);
	}

	const candidates = toRelativePathCandidates(params);
	for (const candidate of candidates) {
		const category = categoryFromPageRelativePath(candidate);
		if (!category) continue;
		const slug = toSafeWikiSlug(filePathToSlug(candidate));
		if (!slug) continue;
		return buildWikiLinkRef(slug, candidate);
	}

	const fallback = fallbackWikiSlugFromUri(
		params.sourceUri,
		params.sourceCategory,
	);
	if (fallback) {
		return buildWikiLinkRef(fallback.slug, fallback.pagePath);
	}
	return null;
};
