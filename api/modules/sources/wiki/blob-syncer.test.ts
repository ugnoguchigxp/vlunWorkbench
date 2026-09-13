import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const blobs: Array<{ name: string }> = [];
const uploaded: string[] = [];
const deleted: string[] = [];
const downloaded: Array<{ name: string; dest: string }> = [];

mock.module("@azure/storage-blob", () => ({
	BlobServiceClient: {
		fromConnectionString() {
			return {
				getContainerClient() {
					return {
						createIfNotExists: async () => undefined,
						getBlockBlobClient(name: string) {
							return {
								uploadFile: async () => {
									uploaded.push(name);
								},
							};
						},
						getBlobClient(name: string) {
							return {
								downloadToFile: async (dest: string) => {
									downloaded.push({ name, dest });
									await fs.mkdir(path.dirname(dest), { recursive: true });
									await fs.writeFile(dest, `blob:${name}`, "utf8");
								},
							};
						},
						async *listBlobsFlat() {
							for (const blob of blobs) yield blob;
						},
						deleteBlob: async (name: string) => {
							deleted.push(name);
						},
					};
				},
			};
		},
	},
}));

const { WikiBlobSyncer } = await import("./blob-sync");

describe("WikiBlobSyncer", () => {
	let contentRoot: string;

	beforeEach(async () => {
		blobs.length = 0;
		uploaded.length = 0;
		deleted.length = 0;
		downloaded.length = 0;
		contentRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wiki-blob-"));
	});

	afterEach(async () => {
		await fs.rm(contentRoot, { recursive: true, force: true });
	});

	it("pushes local files and deletes remote orphans", async () => {
		await fs.mkdir(path.join(contentRoot, "guide"), { recursive: true });
		await fs.writeFile(path.join(contentRoot, "guide", "setup.md"), "# Setup\n");
		await fs.writeFile(path.join(contentRoot, "meta.json"), "{}");
		blobs.push({ name: "wiki/orphan.md" }, { name: "wiki/guide/setup.md" });
		const syncer = new WikiBlobSyncer({
			contentRoot,
			connectionString: "UseDevelopmentStorage=true",
			containerName: "wiki",
			prefix: "wiki",
			pullIntervalMs: 60_000,
		});
		const result = await syncer.push();
		expect(result).toMatchObject({
			enabled: true,
			direction: "push",
			uploadedFiles: 2,
			deletedFiles: 1,
		});
		expect(uploaded).toEqual(
			expect.arrayContaining(["wiki/guide/setup.md", "wiki/meta.json"]),
		);
		expect(deleted).toEqual(["wiki/orphan.md"]);
	});

	it("pulls remote files, skips unsafe names, and respects the interval", async () => {
		blobs.push(
			{ name: "wiki/guide/setup.md" },
			{ name: "wiki/../escape.md" },
			{ name: "wiki/.git/config" },
		);
		await fs.mkdir(path.join(contentRoot, "stale"), { recursive: true });
		await fs.writeFile(path.join(contentRoot, "stale", "old.md"), "old");
		const syncer = new WikiBlobSyncer({
			contentRoot,
			connectionString: "UseDevelopmentStorage=true",
			containerName: "wiki",
			prefix: "wiki",
			pullIntervalMs: 60_000,
		});
		const first = await syncer.pull({ force: true });
		expect(first.downloadedFiles).toBe(1);
		expect(first.skippedFiles).toBe(2);
		expect(first.deletedFiles).toBe(1);
		expect(downloaded).toEqual([
			{
				name: "wiki/guide/setup.md",
				dest: path.join(contentRoot, "guide", "setup.md"),
			},
		]);
		const skipped = await syncer.pull();
		expect(skipped.downloadedFiles).toBe(0);
		expect(skipped.direction).toBe("pull");
	});
});
