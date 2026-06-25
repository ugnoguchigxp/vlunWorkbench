import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DastArtifactStorage } from "./dast-artifact-storage";

describe("DastArtifactStorage", () => {
	let tempDir: string;
	let storage: DastArtifactStorage;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dast-artifacts-"));
		storage = new DastArtifactStorage(tempDir);
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("stores JSON, text, and binary artifacts with metadata", async () => {
		const json = await storage.saveJsonArtifact("run-1", "raw", { ok: true }, "raw.json");
		const text = await storage.saveTextArtifact("run-1", "logs", "token=secret", "log.txt");
		const png = await storage.saveBinaryArtifact(
			"run-1",
			"screenshots",
			new Uint8Array([1, 2, 3]),
			"screen.png",
		);
		expect(json.sha256).toHaveLength(64);
		expect(text.sizeBytes).toBeGreaterThan(0);
		expect(png.sizeBytes).toBe(3);
		expect(await storage.readTextArtifact(json.path)).toContain('"ok": true');
	});

	it("redacts DAST auth headers and cookies before persistence", async () => {
		const artifact = await storage.saveJsonArtifact(
			"run-1",
			"raw",
			{
				request: {
					headers: {
						Authorization: "Bearer headerTokenValue123",
						Cookie: "session=secretSessionValue123; theme=light",
						"x-api-key": "jsonHeaderSecret123",
					},
				},
			},
			"headers.json",
		);

		const content = await storage.readTextArtifact(artifact.path);
		expect(content).not.toContain("headerTokenValue123");
		expect(content).not.toContain("secretSessionValue123");
		expect(content).not.toContain("jsonHeaderSecret123");
		expect(content).toContain("[REDACTED]");
	});

	it("rejects path traversal when reading", async () => {
		await expect(storage.readTextArtifact("../outside.txt")).rejects.toThrow(
			"Path traversal detected",
		);
	});
});
