import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createFolder,
	deleteFolder,
	deletePage,
	ensureContentRoot,
	listFolders,
	listPages,
	readPage,
	renameFolder,
	writePage,
} from "./content-repo";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

async function tempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "content-repo-"));
	roots.push(root);
	return root;
}

describe("wiki content repository", () => {
	it("creates a category home and migrates a legacy top-level index", async () => {
		const root = await tempRoot();
		await fs.mkdir(path.join(root, "pages"), { recursive: true });
		await fs.writeFile(path.join(root, "pages", "index.md"), "# Legacy\n", "utf8");
		await ensureContentRoot(root);
		expect(
			await fs.readFile(path.join(root, "pages", "tech", "index.md"), "utf8"),
		).toContain("Legacy");
		await ensureContentRoot(root);
		const pages = await listPages(root);
		expect(pages.some((page) => page.slug === "tech")).toBe(true);
		expect(await listFolders(root)).toEqual(
			expect.arrayContaining([{ path: "tech" }]),
		);
	});

	it("writes, reads, and deletes nested pages", async () => {
		const root = await tempRoot();
		await ensureContentRoot(root);
		const created = await writePage(
			root,
			"guide/setup",
			"Setup",
			"# Setup\nInstall bun.\n",
			{ tags: ["ops"] },
		);
		expect(created.hash).toMatch(/^[a-f0-9]{64}$/);
		expect(await readPage(root, "guide/setup")).toMatchObject({
			slug: "guide/setup",
			title: "Setup",
		});
		expect(await readPage(root, "missing")).toBeNull();
		await expect(writePage(root, "", "Home", "body", {})).rejects.toThrow(
			"Top-level page is not allowed",
		);
		await expect(
			writePage(root, "guide/setup", "Setup", "body", {}, {
				relativePath: "other.md",
			}),
		).rejects.toThrow("Existing page path does not match slug");
		const folderPage = await writePage(root, "notes", "Notes", "# Notes\n", {});
		expect(folderPage.path).toContain(`${path.sep}notes${path.sep}index.md`);
		expect(await readPage(root, "notes")).toMatchObject({ title: "Notes" });
		const deleted = await deletePage(root, "guide/setup");
		expect(deleted).toContain("setup.md");
		await expect(deletePage(root, "guide/setup")).rejects.toThrow("Page not found");
	});

	it("creates, renames, and deletes folders", async () => {
		const root = await tempRoot();
		await ensureContentRoot(root);
		await writePage(root, "docs/one", "One", "# One\n", {});
		const created = await createFolder(root, "archive");
		expect(created.path).toBe("archive");
		await expect(createFolder(root, "archive")).rejects.toThrow(
			"Folder already exists",
		);
		await expect(renameFolder(root, "docs", "docs")).rejects.toThrow(
			"Folder path is unchanged",
		);
		await expect(renameFolder(root, "docs", "docs/nested")).rejects.toThrow(
			"Cannot move a folder into itself",
		);
		const renamed = await renameFolder(root, "docs", "guides");
		expect(renamed.movedPages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ from: "docs/one", to: "guides/one" }),
			]),
		);
		await expect(renameFolder(root, "guides", "archive")).rejects.toThrow(
			"Folder already exists",
		);
		const deleted = await deleteFolder(root, "guides");
		expect(deleted.deletedSlugs).toContain("guides/one");
		await expect(deleteFolder(root, "guides")).rejects.toThrow();
		await expect(createFolder(root, "")).rejects.toThrow("Invalid folder path");
	});
});
