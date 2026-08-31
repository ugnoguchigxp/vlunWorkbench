import { z } from "zod";
import { GIT_OBJECT_ID_PATTERN } from "../modules/sources/wiki/git-object-id";
import type { SourceRepository } from "../modules/sources/source.repository";
import type { WikiBlobSyncer } from "../modules/sources/wiki/blob-sync";
import {
	extractRemainderFromPathname,
	isSafeSlug,
	sanitizeSlug,
} from "../modules/sources/wiki/slug";

const pageSlugSchema = z
	.string()
	.transform((value) => sanitizeSlug(value))
	.refine((value) => value !== "" && isSafeSlug(value), {
		message: "Invalid page slug",
	});

export const writePageSchema = z.object({
	slug: pageSlugSchema,
	title: z.string().min(1),
	body: z.string(),
	meta: z.record(z.string(), z.unknown()).optional(),
});

export const updatePageSchema = z.object({
	slug: pageSlugSchema.optional(),
	title: z.string().min(1).optional(),
	body: z.string(),
	meta: z.record(z.string(), z.unknown()).optional(),
	commitMessage: z.string().min(1).optional(),
});

const folderPathSchema = pageSlugSchema.refine((value) => value !== "", {
	message: "Invalid folder path",
});

export const writeFolderSchema = z.object({
	path: folderPathSchema,
});

export const diffQuerySchema = z.object({
	from: z
		.string()
		.regex(GIT_OBJECT_ID_PATTERN, "from must be a full Git object ID"),
	to: z
		.string()
		.regex(GIT_OBJECT_ID_PATTERN, "to must be a full Git object ID"),
});

export const searchQuerySchema = z.object({
	q: z.string().optional(),
});

export const slugFromRequestPath = (url: string, prefix: string): string => {
	const pathname = new URL(url).pathname;
	return sanitizeSlug(extractRemainderFromPathname(pathname, prefix));
};

export const rawPageSlugFromRequestPath = (url: string): string => {
	const slugWithSuffix = slugFromRequestPath(url, "/api/sources/pages/");
	if (!slugWithSuffix.endsWith("/raw")) {
		return "\0";
	}
	return sanitizeSlug(slugWithSuffix.slice(0, -"/raw".length));
};

export const invalidSlugResponse = (slug: string) => ({
	message: "Invalid page slug",
	slug,
});

export const isInvalidSlug = (slug: string): boolean => !isSafeSlug(slug);

export const invalidFolderResponse = (folderPath: string) => ({
	message: "Invalid folder path",
	path: folderPath,
});

export const isInvalidFolderPath = (folderPath: string): boolean =>
	folderPath === "" || !isSafeSlug(folderPath);

export const folderErrorStatus = (error: unknown): 400 | 404 | 409 => {
	const message = error instanceof Error ? error.message : "";
	if (message.includes("already exists") || message.includes("conflicts"))
		return 409;
	if (message.includes("not found") || message.includes("ENOENT")) return 404;
	return 400;
};

export type SourcesRouteDeps = {
	contentRoot: string;
	sourceRepository: SourceRepository;
	wikiBlobSyncer?: WikiBlobSyncer | null;
};

export type SourceReindexSummary = {
	importedFiles: number;
	skippedFiles: number;
	removedSources: number;
};

export const makeExcerpt = (body: string, query: string): string => {
	const compact = body.replace(/\s+/g, " ").trim();
	if (!compact) return "";
	const lowered = compact.toLowerCase();
	const queryLower = query.toLowerCase();
	const index = lowered.indexOf(queryLower);
	if (index === -1) return compact.slice(0, 180);
	const start = Math.max(0, index - 60);
	const end = Math.min(compact.length, index + query.length + 120);
	return compact.slice(start, end);
};

export const searchableMetaText = (meta: Record<string, unknown>): string => {
	const tags = meta.tags;
	if (Array.isArray(tags)) {
		return tags
			.map((tag) => String(tag).trim())
			.filter(Boolean)
			.join(" ");
	}
	if (typeof tags === "string") {
		return tags;
	}
	return "";
};
