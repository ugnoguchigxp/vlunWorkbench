import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readProjectModelSources } from "./project-source-reader";

let root: string | null = null;

afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = null;
});

describe("project model source reader", () => {
	test("bounds all directory entries, including unsupported files", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "model-sources-"));
		await Promise.all([
			writeFile(path.join(root, "first.txt"), "ignored"),
			writeFile(path.join(root, "second.ts"), "app.get('/ok', handler)"),
		]);
		await expect(
			readProjectModelSources(root, { maxEntries: 1 }),
		).rejects.toThrow("application_model_entry_limit");
	});

	test("bounds recursive directory depth", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "model-sources-"));
		const nested = path.join(root, "one", "two");
		await mkdir(nested, { recursive: true });
		await writeFile(path.join(nested, "route.ts"), "app.get('/ok', handler)");
		await expect(
			readProjectModelSources(root, { maxDepth: 1 }),
		).rejects.toThrow("application_model_depth_limit");
	});
});
