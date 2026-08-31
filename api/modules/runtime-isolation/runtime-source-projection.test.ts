import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materializeRuntimeSourceProjection } from "./runtime-source-projection";

describe("materializeRuntimeSourceProjection", () => {
	let root: string;
	let snapshotPath: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-projection-test-"));
		snapshotPath = path.join(root, "snapshot");
		await fs.mkdir(path.join(snapshotPath, "src"), { recursive: true });
		await fs.mkdir(path.join(snapshotPath, "node_modules", "untrusted"), {
			recursive: true,
		});
		await fs.mkdir(
			path.join(snapshotPath, "packages", "app", "node_modules", "nested"),
			{ recursive: true },
		);
		await fs.mkdir(path.join(snapshotPath, "packages", "app", "dist"), {
			recursive: true,
		});
		await fs.mkdir(path.join(snapshotPath, "packages", "app", ".git"), {
			recursive: true,
		});
		await fs.writeFile(path.join(snapshotPath, "src", "app.ts"), "export const ok = true;\n");
		await fs.writeFile(path.join(snapshotPath, ".env"), "DATABASE_URL=secret-marker\n");
		await fs.writeFile(path.join(snapshotPath, ".npmrc"), "//registry.example/:_authToken=secret-marker\n");
		await fs.writeFile(path.join(snapshotPath, "data.sqlite"), "database-marker\n");
		await fs.writeFile(path.join(snapshotPath, "socket.sock"), "socket-marker\n");
		await fs.writeFile(
			path.join(snapshotPath, "node_modules", "untrusted", "postinstall.js"),
			"throw new Error('must not be projected');\n",
		);
		await fs.writeFile(
			path.join(
				snapshotPath,
				"packages",
				"app",
				"node_modules",
				"nested",
				"postinstall.js",
			),
			"throw new Error('nested dependency must not be projected');\n",
		);
		await fs.writeFile(
			path.join(snapshotPath, "packages", "app", "dist", "bundle.js"),
			"generated();\n",
		);
		await fs.writeFile(
			path.join(snapshotPath, "packages", "app", ".git", "config"),
			"credential = must-not-be-projected\n",
		);
		await fs.symlink(path.join(snapshotPath, "src", "app.ts"), path.join(snapshotPath, "app-link"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("copies only the sanitized snapshot and omits credential, database, socket, and symlink inputs", async () => {
		const projection = await materializeRuntimeSourceProjection({
			snapshot: { projectPath: snapshotPath, snapshotDigest: "a".repeat(64) },
		});
		try {
			expect(projection.sourceSnapshotDigest).toBe("a".repeat(64));
			expect(projection.policyVersion).toBe(1);
			expect(projection.projectionDigest).toMatch(/^[a-f0-9]{64}$/);
			expect(projection.excludedCategoryCounts).toEqual({
				credential: 2,
				database: 1,
				socket: 1,
				symlink: 1,
			});
			await expect(fs.readFile(path.join(projection.projectPath, "src", "app.ts"), "utf8")).resolves.toContain("ok");
			for (const excluded of [
				".env",
				".npmrc",
				"data.sqlite",
				"socket.sock",
				"app-link",
				"node_modules",
				"packages/app/node_modules",
				"packages/app/dist",
				"packages/app/.git",
			]) {
				await expect(fs.lstat(path.join(projection.projectPath, excluded))).rejects.toThrow();
			}
		} finally {
			await projection.cleanup();
			await projection.cleanup();
		}
	});

	it("binds executable mode and contents into the projection digest", async () => {
		const first = await materializeRuntimeSourceProjection({
			snapshot: { projectPath: snapshotPath, snapshotDigest: "b".repeat(64) },
		});
		try {
			await fs.chmod(path.join(snapshotPath, "src", "app.ts"), 0o755);
			const second = await materializeRuntimeSourceProjection({
				snapshot: { projectPath: snapshotPath, snapshotDigest: "b".repeat(64) },
			});
			try {
				expect(second.projectionDigest).not.toBe(first.projectionDigest);
			} finally {
				await second.cleanup();
			}
		} finally {
			await first.cleanup();
		}
	});
});
