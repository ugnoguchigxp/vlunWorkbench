import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { materializeProfileInputSnapshot } from "./profile-input-snapshot";

describe("materializeProfileInputSnapshot", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			roots.splice(0).map((root) =>
				fs.rm(root, { recursive: true, force: true }),
			),
		);
	});

	it("copies and fingerprints profile files independently of later source changes", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "vwb-profile-input-source-"),
		);
		roots.push(repositoryPath);
		await fs.mkdir(path.join(repositoryPath, "dist"));
		await fs.writeFile(path.join(repositoryPath, "dist", "image.tar"), "v1");

		const snapshot = await materializeProfileInputSnapshot({
			repositoryPath,
			imageTar: "dist/image.tar",
		});
		expect(snapshot).not.toBeNull();
		if (!snapshot) return;
		roots.push(snapshot.rootPath);
		await fs.writeFile(path.join(repositoryPath, "dist", "image.tar"), "v2");

		expect(
			await fs.readFile(path.join(snapshot.rootPath, "dist", "image.tar"), "utf8"),
		).toBe("v1");
		expect(snapshot.bindings.imageTar).toMatch(
			/^dist\/image\.tar@sha256:[a-f0-9]{64}$/,
		);
		await snapshot.cleanup();
	});
});
