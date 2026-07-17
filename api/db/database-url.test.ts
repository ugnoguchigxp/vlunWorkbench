import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	canonicalDatabasePath,
	databaseIdFromUrl,
	defaultWriterSocketPath,
	writerLockPath,
} from "./database-url";

describe("SQLite database identity", () => {
	it("collapses real and symlinked paths before deriving Writer identity", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vuln-db-identity-"));
		try {
			const realDirectory = path.join(root, "real");
			const aliasDirectory = path.join(root, "alias");
			await mkdir(realDirectory);
			await symlink(realDirectory, aliasDirectory);
			const realUrl = `file:${path.join(realDirectory, "database.sqlite")}`;
			const aliasUrl = `file:${path.join(aliasDirectory, "database.sqlite")}`;

			expect(canonicalDatabasePath(aliasUrl)).toBe(
				canonicalDatabasePath(realUrl),
			);
			expect(databaseIdFromUrl(aliasUrl)).toBe(databaseIdFromUrl(realUrl));
			expect(defaultWriterSocketPath(aliasUrl)).toBe(
				defaultWriterSocketPath(realUrl),
			);
			expect(writerLockPath(aliasUrl)).toBe(writerLockPath(realUrl));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
