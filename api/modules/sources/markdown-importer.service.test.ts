import {
	access,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	collectMarkdownFiles,
	importMarkdownDirectory,
} from "./markdown-importer.service";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map(async (dir) => {
			await rm(dir, { recursive: true, force: true });
		}),
	);
});

describe("collectMarkdownFiles", () => {
	it("collects markdown files recursively under pages/", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "regular-rag-importer-"));
		tempDirs.push(root);
		const pagesRoot = path.join(root, "pages");
		await mkdir(path.join(pagesRoot, "a", "b"), { recursive: true });

		await writeFile(path.join(pagesRoot, "index.md"), "# Home\n", "utf8");
		await writeFile(path.join(pagesRoot, "a", "nested.md"), "# Nested\n", "utf8");
		await writeFile(path.join(pagesRoot, "a", "b", "deep.md"), "# Deep\n", "utf8");
		await writeFile(path.join(pagesRoot, "a", "note.txt"), "ignore", "utf8");

		const files = await collectMarkdownFiles(root);
		expect(files).toEqual(
			[
				path.join(pagesRoot, "a", "b", "deep.md"),
				path.join(pagesRoot, "a", "nested.md"),
				path.join(pagesRoot, "index.md"),
			].sort((x, y) => x.localeCompare(y)),
		);
	});

	it("rejects top-level markdown files under pages/ except legacy index.md", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "regular-rag-importer-"));
		tempDirs.push(root);
		const pagesRoot = path.join(root, "pages");
		await mkdir(path.join(pagesRoot, "tech"), { recursive: true });

		await writeFile(path.join(pagesRoot, "index.md"), "# Legacy Home\n", "utf8");
		await writeFile(path.join(pagesRoot, "foo.md"), "# Invalid Top\n", "utf8");

		const sourceRepository = {
			upsertSourceDocument: vi.fn(),
			deleteStaleSourcesForRoot: vi.fn(),
		};

		await expect(
			importMarkdownDirectory({
				contentRoot: root,
				sourceRepository: sourceRepository as never,
				embedFragments: false,
			}),
		).rejects.toThrow("Top-level markdown is not allowed under pages/");

		await expect(access(path.join(pagesRoot, "index.md"))).rejects.toThrow();
		expect(
			await readFile(path.join(pagesRoot, "tech", "index.md"), "utf8"),
		).toContain("Legacy Home");
	});

	it("registers wikiSlug metadata from folder/file path", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "regular-rag-importer-"));
		tempDirs.push(root);
		const pagesRoot = path.join(root, "pages");
		await mkdir(path.join(pagesRoot, "tech", "hono"), { recursive: true });
		await writeFile(
			path.join(pagesRoot, "tech", "hono", "routing.md"),
			"# Routing\n\ncontent",
			"utf8",
		);

		const sourceRepository = {
			upsertSourceDocument: vi.fn().mockResolvedValue("source-1"),
			deleteStaleSourcesForRoot: vi.fn().mockResolvedValue(0),
		};

		await importMarkdownDirectory({
			contentRoot: root,
			sourceRepository: sourceRepository as never,
			embedFragments: false,
		});

		expect(sourceRepository.upsertSourceDocument).toHaveBeenCalledTimes(1);
		const firstCall = sourceRepository.upsertSourceDocument.mock.calls[0]?.[0];
		expect(firstCall).toMatchObject({
			sourceKind: "wiki",
			category: "tech",
			metadata: {
				relativePath: "pages/tech/hono/routing.md",
				wikiSlug: "tech/hono/routing",
			},
		});
	});
});
