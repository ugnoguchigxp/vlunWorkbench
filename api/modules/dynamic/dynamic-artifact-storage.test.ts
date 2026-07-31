import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DynamicArtifactStorage } from "./dynamic-artifact-storage";

describe("DynamicArtifactStorage", () => {
	let root: string;
	let source: string;
	let storage: DynamicArtifactStorage;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "dynamic-artifact-test-"));
		source = path.join(root, "source.txt");
		storage = new DynamicArtifactStorage(path.join(root, "artifacts"), {
			maxFileBytes: 4,
		});
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("rejects oversized generated artifacts before reading them", async () => {
		await fs.writeFile(source, "12345");
		await expect(
			storage.saveDynamicRawArtifact("run-1", source),
		).rejects.toThrow("dynamic_artifact_file_limit_exceeded");
	});

	it("bounds saved logs and downloaded artifact reads", async () => {
		await expect(storage.saveDynamicLog("run-1", "stdout", "12345")).rejects.toThrow(
			"dynamic_artifact_file_limit_exceeded",
		);

		const saved = await storage.saveDynamicLog("run-1", "stdout", "1234");
		await fs.appendFile(path.join(root, "artifacts", saved.path), "5");
		await expect(storage.readDynamicTextArtifact(saved.path)).rejects.toThrow(
			"dynamic_artifact_file_limit_exceeded",
		);
	});
});
