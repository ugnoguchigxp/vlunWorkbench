import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeTrivyDatabaseMetadata } from "./scanner-data-metadata";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("Trivy database metadata normalization", () => {
	test("removes download-time variance while preserving database timestamps", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "trivy-metadata-test-"));
		roots.push(root);
		const metadataPath = path.join(root, "metadata.json");
		await Bun.write(
			metadataPath,
			JSON.stringify({
				Version: 2,
				NextUpdate: "2026-08-16T07:02:08.024Z",
				UpdatedAt: "2026-08-15T07:02:08.024Z",
				DownloadedAt: "2026-08-15T08:13:29.088Z",
			}),
		);

		await normalizeTrivyDatabaseMetadata(metadataPath);

		expect(JSON.parse(await readFile(metadataPath, "utf8"))).toEqual({
			Version: 2,
			NextUpdate: "2026-08-16T07:02:08.024Z",
			UpdatedAt: "2026-08-15T07:02:08.024Z",
			DownloadedAt: "2026-08-15T07:02:08.024Z",
		});
	});

	test("fails closed for malformed timestamps", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "trivy-metadata-test-"));
		roots.push(root);
		const metadataPath = path.join(root, "metadata.json");
		await Bun.write(
			metadataPath,
			JSON.stringify({ UpdatedAt: "invalid", DownloadedAt: "invalid" }),
		);

		await expect(
			normalizeTrivyDatabaseMetadata(metadataPath),
		).rejects.toThrow("trivy_database_metadata_invalid:DownloadedAt");
	});
});
