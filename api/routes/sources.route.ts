import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { requireAdminForMutation } from "../middleware/auth";
import {
	categoryFromPageRelativePath,
	DEFAULT_WIKI_CATEGORY,
	topLevelCategoriesFromFolderPaths,
} from "../modules/sources/wiki/category";
import {
	commitDeleteChange,
	commitFileChange,
	commitPathsChange,
	createFolder,
	deleteFolder,
	deletePage,
	ensureContentRoot,
	ensureGitRepo,
	getGitSummary,
	getPageDiff,
	getPageHistory,
	listFolders,
	listPages,
	readPage,
	renameFolder,
	writePage,
} from "../modules/sources/wiki/content-repo";
import { importMarkdownDirectory } from "../modules/sources/markdown-importer.service";
import {
	diffQuerySchema,
	folderErrorStatus,
	invalidFolderResponse,
	invalidSlugResponse,
	isInvalidFolderPath,
	isInvalidSlug,
	makeExcerpt,
	rawPageSlugFromRequestPath,
	searchableMetaText,
	searchQuerySchema,
	type SourceReindexSummary,
	type SourcesRouteDeps,
	slugFromRequestPath,
	updatePageSchema,
	writeFolderSchema,
	writePageSchema,
} from "./sources-route-support";

export function createSourcesRoute(deps: SourcesRouteDeps) {
	const ensureSourceRuntime = async (
		options: { forceBlobPull?: boolean } = {},
	): Promise<void> => {
		await deps.wikiBlobSyncer?.pull({ force: options.forceBlobPull });
		await ensureContentRoot(deps.contentRoot);
		await ensureGitRepo(deps.contentRoot);
	};

	const publishWikiContent = async (): Promise<void> => {
		await deps.wikiBlobSyncer?.push();
	};

	const syncSourceIndex = async (): Promise<SourceReindexSummary> => {
		const result = await importMarkdownDirectory({
			contentRoot: deps.contentRoot,
			sourceRepository: deps.sourceRepository,
			embedFragments: false,
		});
		return {
			importedFiles: result.importedFiles,
			skippedFiles: result.skippedFiles,
			removedSources: result.removedSources,
		};
	};

	return new Hono()
		.use("*", requireAdminForMutation())
		.get("/health", async (c) => {
			await ensureSourceRuntime();
			const git = await getGitSummary(deps.contentRoot);
			return c.json({
				service: "vuln-workbench-knowledge",
				git,
			});
		})
		.get("/tree", async (c) => {
			await ensureSourceRuntime();
			const [items, folders] = await Promise.all([
				listPages(deps.contentRoot),
				listFolders(deps.contentRoot),
			]);
			return c.json({ items, folders });
		})
		.get("/categories", async (c) => {
			await ensureSourceRuntime();
			const [folders, indexedCategories] = await Promise.all([
				listFolders(deps.contentRoot),
				deps.sourceRepository.listCategories(["wiki"]),
			]);
			const categories = new Set<string>([
				DEFAULT_WIKI_CATEGORY,
				...indexedCategories,
				...topLevelCategoriesFromFolderPaths(
					folders.map((folder) => folder.path),
				),
			]);
			return c.json({
				items: [...categories].sort((a, b) => a.localeCompare(b)),
			});
		})
		.get("/search", zValidator("query", searchQuerySchema), async (c) => {
			await ensureSourceRuntime();
			const { q } = c.req.valid("query");
			const query = (q ?? "").trim();
			if (!query) {
				return c.json({ items: [] });
			}

			const tree = await listPages(deps.contentRoot);
			const hits: Array<{ slug: string; excerpt: string }> = [];
			const queryLower = query.toLowerCase();

			for (const item of tree) {
				const page = await readPage(deps.contentRoot, item.slug);
				if (!page) continue;
				const metaText = searchableMetaText(page.meta);
				const searchableText = `${page.slug}\n${page.title}\n${metaText}\n${page.body}`;
				const haystack = searchableText.toLowerCase();
				if (!haystack.includes(queryLower)) continue;
				hits.push({
					slug: page.slug,
					excerpt: makeExcerpt(searchableText, query),
				});
				if (hits.length >= 40) break;
			}

			return c.json({ items: hits });
		})
		.post("/reindex", async (c) => {
			await ensureSourceRuntime({ forceBlobPull: true });
			const result = await importMarkdownDirectory({
				contentRoot: deps.contentRoot,
				sourceRepository: deps.sourceRepository,
			});
			return c.json({
				ok: true,
				...result,
			});
		})
		.get("/folders", async (c) => {
			await ensureSourceRuntime();
			const items = await listFolders(deps.contentRoot);
			return c.json({ items });
		})
		.post("/folders", zValidator("json", writeFolderSchema), async (c) => {
			await ensureSourceRuntime();
			const payload = c.req.valid("json");
			try {
				const created = await createFolder(deps.contentRoot, payload.path);
				const commit = await commitFileChange(
					deps.contentRoot,
					created.keepFilePath,
					`docs(folder): create ${created.path}`,
				);
				await publishWikiContent();
				return c.json({ ok: true, path: created.path, commit });
			} catch (error) {
				return c.json(
					{
						message:
							error instanceof Error ? error.message : "Folder create failed",
						path: payload.path,
					},
					folderErrorStatus(error),
				);
			}
		})
		.put("/folders/*", zValidator("json", writeFolderSchema), async (c) => {
			await ensureSourceRuntime();
			const folderPath = slugFromRequestPath(
				c.req.url,
				"/api/sources/folders/",
			);
			if (isInvalidFolderPath(folderPath)) {
				return c.json(invalidFolderResponse(folderPath), 400);
			}
			const payload = c.req.valid("json");
			try {
				const renamed = await renameFolder(
					deps.contentRoot,
					folderPath,
					payload.path,
				);
				const commit = await commitPathsChange(
					deps.contentRoot,
					[renamed.oldAbsolutePath, renamed.newAbsolutePath],
					`docs(folder): rename ${renamed.from} to ${renamed.path}`,
				);
				const reindexed = await syncSourceIndex();
				await publishWikiContent();
				return c.json({
					ok: true,
					from: renamed.from,
					path: renamed.path,
					movedPages: renamed.movedPages,
					reindexed,
					commit,
				});
			} catch (error) {
				return c.json(
					{
						message:
							error instanceof Error ? error.message : "Folder rename failed",
						path: folderPath,
					},
					folderErrorStatus(error),
				);
			}
		})
		.delete("/folders/*", async (c) => {
			await ensureSourceRuntime();
			const folderPath = slugFromRequestPath(
				c.req.url,
				"/api/sources/folders/",
			);
			if (isInvalidFolderPath(folderPath)) {
				return c.json(invalidFolderResponse(folderPath), 400);
			}
			try {
				const deleted = await deleteFolder(deps.contentRoot, folderPath);
				const commit = await commitPathsChange(
					deps.contentRoot,
					[deleted.absolutePath],
					`docs(folder): delete ${deleted.path}`,
				);
				const reindexed = await syncSourceIndex();
				await publishWikiContent();
				return c.json({
					ok: true,
					path: deleted.path,
					deletedSlugs: deleted.deletedSlugs,
					reindexed,
					commit,
				});
			} catch (error) {
				return c.json(
					{
						message:
							error instanceof Error ? error.message : "Folder delete failed",
						path: folderPath,
					},
					folderErrorStatus(error),
				);
			}
		})
		.get("/pages/*/raw", async (c) => {
			await ensureSourceRuntime();
			const slug = rawPageSlugFromRequestPath(c.req.url);
			if (isInvalidSlug(slug)) {
				return c.json(invalidSlugResponse(slug), 400);
			}
			const page = await readPage(deps.contentRoot, slug);
			if (!page) {
				return c.json({ message: "Page not found", slug }, 404);
			}
			return c.body(page.body, 200, {
				"Content-Type": "text/markdown; charset=utf-8",
			});
		})
		.get("/pages/*", async (c) => {
			await ensureSourceRuntime();
			const slug = slugFromRequestPath(c.req.url, "/api/sources/pages/");
			if (isInvalidSlug(slug)) {
				return c.json(invalidSlugResponse(slug), 400);
			}
			const page = await readPage(deps.contentRoot, slug);
			if (!page) {
				return c.json({ message: "Page not found", slug }, 404);
			}
			return c.json(page);
		})
		.post("/pages", zValidator("json", writePageSchema), async (c) => {
			await ensureSourceRuntime();
			const payload = c.req.valid("json");
			const existing = await readPage(deps.contentRoot, payload.slug);
			if (existing) {
				return c.json(
					{ message: "Page already exists", slug: payload.slug },
					409,
				);
			}
			const { path, hash, content } = await writePage(
				deps.contentRoot,
				payload.slug,
				payload.title,
				payload.body,
				payload.meta ?? {},
			);
			const commit = await commitFileChange(
				deps.contentRoot,
				path,
				`docs(page): create ${payload.slug || "home"}`,
			);
			const savedPage = await readPage(deps.contentRoot, payload.slug);
			if (!savedPage) {
				return c.json({ message: "Page save verification failed" }, 500);
			}
			const category = categoryFromPageRelativePath(savedPage.path);
			if (!category) {
				return c.json(
					{
						message:
							"Top-level documents are not allowed. Use pages/<category>/...",
						slug: savedPage.slug,
					},
					400,
				);
			}
			const sourceMetadata = {
				...savedPage.meta,
				relativePath: `pages/${savedPage.path}`,
				wikiSlug: savedPage.slug,
			};
			await deps.sourceRepository.upsertSourceDocument({
				sourceKind: "wiki",
				category,
				uri: `${deps.contentRoot}/pages/${savedPage.path}`,
				title: savedPage.title,
				body: content,
				contentHash: hash,
				metadata: sourceMetadata,
			});
			await publishWikiContent();
			return c.json({ ok: true, slug: savedPage.slug, hash, commit });
		})
		.put("/pages/*", zValidator("json", updatePageSchema), async (c) => {
			await ensureSourceRuntime();
			const slug = slugFromRequestPath(c.req.url, "/api/sources/pages/");
			if (isInvalidSlug(slug)) {
				return c.json(invalidSlugResponse(slug), 400);
			}
			const existing = await readPage(deps.contentRoot, slug);
			if (!existing) {
				return c.json({ message: "Page not found", slug }, 404);
			}
			const payload = c.req.valid("json");
			const targetSlug = payload.slug ?? slug;
			if (targetSlug !== slug) {
				const targetExisting = await readPage(deps.contentRoot, targetSlug);
				if (targetExisting) {
					return c.json(
						{ message: "Page already exists", slug: targetSlug },
						409,
					);
				}
			}
			const title = payload.title ?? existing.title;
			const meta = payload.meta ?? existing.meta;
			const { path, hash, content } = await writePage(
				deps.contentRoot,
				targetSlug,
				title,
				payload.body,
				meta,
				targetSlug === slug ? { relativePath: existing.path } : undefined,
			);
			let commit: string | null;
			if (targetSlug === slug) {
				commit = await commitFileChange(
					deps.contentRoot,
					path,
					payload.commitMessage ?? `docs(page): update ${slug || "home"}`,
				);
			} else {
				const deletedPath = await deletePage(deps.contentRoot, slug);
				commit = await commitPathsChange(
					deps.contentRoot,
					[path, deletedPath],
					payload.commitMessage ??
						`docs(page): rename ${slug || "home"} to ${targetSlug || "home"}`,
				);
				await deps.sourceRepository.deleteSourceByUri(
					`${deps.contentRoot}/pages/${existing.path}`,
				);
			}
			const savedPage = await readPage(deps.contentRoot, targetSlug);
			if (!savedPage) {
				return c.json(
					{ message: "Page save verification failed", slug: targetSlug },
					500,
				);
			}
			const category = categoryFromPageRelativePath(savedPage.path);
			if (!category) {
				return c.json(
					{
						message:
							"Top-level documents are not allowed. Use pages/<category>/...",
						slug: savedPage.slug,
					},
					400,
				);
			}
			const sourceMetadata = {
				...savedPage.meta,
				relativePath: `pages/${savedPage.path}`,
				wikiSlug: savedPage.slug,
			};
			await deps.sourceRepository.upsertSourceDocument({
				sourceKind: "wiki",
				category,
				uri: `${deps.contentRoot}/pages/${savedPage.path}`,
				title: savedPage.title,
				body: content,
				contentHash: hash,
				metadata: sourceMetadata,
			});
			await publishWikiContent();
			return c.json({ ok: true, slug: savedPage.slug, hash, commit });
		})
		.delete("/pages/*", async (c) => {
			await ensureSourceRuntime();
			const slug = slugFromRequestPath(c.req.url, "/api/sources/pages/");
			if (isInvalidSlug(slug)) {
				return c.json(invalidSlugResponse(slug), 400);
			}
			const existing = await readPage(deps.contentRoot, slug);
			if (!existing) {
				return c.json({ message: "Page not found", slug }, 404);
			}
			try {
				const deletedPath = await deletePage(deps.contentRoot, slug);
				const commit = await commitDeleteChange(
					deps.contentRoot,
					deletedPath,
					`docs(page): delete ${slug || "home"}`,
				);
				await deps.sourceRepository.deleteSourceByUri(
					`${deps.contentRoot}/pages/${existing.path}`,
				);
				await publishWikiContent();
				return c.json({ ok: true, slug, commit });
			} catch {
				return c.json({ message: "Page not found", slug }, 404);
			}
		})
		.get("/history/*", async (c) => {
			await ensureSourceRuntime();
			const slug = slugFromRequestPath(c.req.url, "/api/sources/history/");
			if (isInvalidSlug(slug)) {
				return c.json(invalidSlugResponse(slug), 400);
			}
			const items = await getPageHistory(deps.contentRoot, slug);
			return c.json({ slug, items });
		})
		.get("/diff/*", zValidator("query", diffQuerySchema), async (c) => {
			await ensureSourceRuntime();
			const slug = slugFromRequestPath(c.req.url, "/api/sources/diff/");
			if (isInvalidSlug(slug)) {
				return c.json(invalidSlugResponse(slug), 400);
			}
			const { from, to } = c.req.valid("query");
			if (!from || !to) {
				return c.json({ message: "from and to query are required" }, 400);
			}
			const diff = await getPageDiff(deps.contentRoot, slug, from, to);
			return c.json({ slug, from, to, diff });
		});
}
