import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStorage } from "./artifact-storage";

describe("ArtifactStorage", () => {
	const tempDir = path.resolve(process.cwd(), "artifacts", "test-scans-temp");
	let storage: ArtifactStorage;

	beforeEach(async () => {
		await fs.mkdir(tempDir, { recursive: true });
		storage = new ArtifactStorage(tempDir);
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should save raw artifact successfully and calculate correct metadata", async () => {
		const scanRunId = "scan-123";
		const sourceFile = path.join(tempDir, "source.json");
		const content = JSON.stringify({ test: "data" });
		await fs.writeFile(sourceFile, content);

		const expectedSha256 = crypto.createHash("sha256").update(content).digest("hex");
		const expectedSize = Buffer.from(content).length;

		const result = await storage.saveRawArtifact(scanRunId, sourceFile);

		expect(result.path).toContain(path.join("raw", "source.json"));
		expect(result.sha256).toBe(expectedSha256);
		expect(result.sizeBytes).toBe(expectedSize);

		// Verify target file exists and content matches
		const absolutePath = path.resolve(tempDir, result.path);
		const targetContent = await fs.readFile(absolutePath, "utf8");
		expect(targetContent).toBe(content);
	});

	it("should save log successfully", async () => {
		const scanRunId = "scan-123";
		const logContent = "some stdout messages";

		const expectedSha256 = crypto
			.createHash("sha256")
			.update(Buffer.from(logContent, "utf8"))
			.digest("hex");
		const expectedSize = Buffer.from(logContent, "utf8").length;

		const result = await storage.saveLog(scanRunId, "stdout", logContent);

		expect(result.path).toContain(path.join("logs", "stdout.log"));
		expect(result.sha256).toBe(expectedSha256);
		expect(result.sizeBytes).toBe(expectedSize);

		const absolutePath = path.resolve(tempDir, result.path);
		const targetContent = await fs.readFile(absolutePath, "utf8");
		expect(targetContent).toBe(logContent);
	});

	it("should reject path traversal in suggestedFilename", async () => {
		const scanRunId = "scan-123";
		const sourceFile = path.join(tempDir, "source.json");
		await fs.writeFile(sourceFile, "{}");

		await expect(
			storage.saveRawArtifact(scanRunId, sourceFile, "../../../outside.json"),
		).rejects.toThrow("Path traversal detected");

		await expect(
			storage.saveLog(scanRunId, "stdout", "content", "../../../outside.log"),
		).rejects.toThrow("Path traversal detected");
	});

	it("bounds reads and rejects symlinks that escape the artifact root", async () => {
		const saved = await storage.saveTextArtifact(
			"scan-123",
			"reports",
			"bounded report",
			"report.md",
		);
		await expect(
			storage.readTextArtifact(saved.path, { maxBytes: 5 }),
		).rejects.toThrow("configured read limit");
		expect(
			await storage.readTextArtifact(saved.path, { maxBytes: 64 }),
		).toBe("bounded report");

		const outside = path.resolve(tempDir, "..", "outside-artifact.txt");
		const link = path.resolve(tempDir, "scan-123", "reports", "escape.md");
		await fs.writeFile(outside, "outside");
		await fs.symlink(outside, link);
		try {
			await expect(storage.readTextArtifact("scan-123/reports/escape.md")).rejects.toThrow(
				"symlink resolves outside",
			);
		} finally {
			await fs.rm(outside, { force: true });
		}
	});
});
