import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReproductionArtifactStorage } from "./reproduction-artifact-storage";

describe("ReproductionArtifactStorage", () => {
	let root: string;
	let storage: ReproductionArtifactStorage;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "reproduction-artifact-test-"));
		storage = new ReproductionArtifactStorage(path.join(root, "artifacts"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("removes only the requested reproduction run directory", async () => {
		await storage.saveReproductionLog("run-1", "stdout", "safe");
		await storage.removeRunDirectory("run-1");
		await expect(fs.stat(path.join(root, "artifacts", "run-1"))).rejects.toThrow();
		await expect(storage.removeRunDirectory("../outside")).rejects.toThrow(
			"Path traversal detected",
		);
	});
});
