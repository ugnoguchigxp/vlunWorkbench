import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256Tree } from "./benchmark-input-provenance";

describe("benchmark input provenance", () => {
	test("hashes a regular tree deterministically and rejects symlinks", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "benchmark-tree-"));
		try {
			await mkdir(path.join(root, "nested"));
			await writeFile(path.join(root, "nested", "input.txt"), "pinned\n");
			const first = await sha256Tree([root]);
			const second = await sha256Tree([root]);
			expect(first).toBe(second);

			await symlink(
				path.join(root, "nested", "input.txt"),
				path.join(root, "linked-input.txt"),
			);
			await expect(sha256Tree([root])).rejects.toThrow(
				"benchmark_provenance_symlink_rejected",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
