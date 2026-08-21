import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordScannerE2EFailureObservation } from "../../testing/scanner-e2e-failure-observation";
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

	it("isolates concurrent tool outputs and rejects a duplicate owner write", async () => {
		const scanRunId = "scan-123";
		const left = storage.forToolRun(scanRunId, "tool-left");
		const right = storage.forToolRun(scanRunId, "tool-right");
		const [leftSaved, rightSaved] = await Promise.all([
			left.saveLog(scanRunId, "stdout", "left"),
			right.saveLog(scanRunId, "stdout", "right"),
		]);
		expect(leftSaved.path).toContain("owners/tool-run/tool-left/logs/stdout.log");
		expect(rightSaved.path).toContain("owners/tool-run/tool-right/logs/stdout.log");
		await expect(left.saveLog(scanRunId, "stdout", "again")).rejects.toMatchObject({
			code: "EEXIST",
		});
		recordScannerE2EFailureObservation("FI-06", {
			profileOutcome: "failed",
			reasonCodes: ["artifact_key_conflict"],
			toolRunCount: 1,
			artifactCount: 1,
		});
	});

	it("rolls back every completed link when an atomic batch has duplicate targets", async () => {
		const owner = storage.forToolRun("scan-123", "tool-atomic");
		await expect(
			owner.saveTextArtifactsAtomically("scan-123", [
				{ subDir: "raw", filename: "result.json", content: "first" },
				{ subDir: "raw", filename: "result.json", content: "second" },
			]),
		).rejects.toThrow();
		await expect(
			fs.stat(
				path.join(
					tempDir,
					"scan-123",
					"owners",
					"tool-run",
					"tool-atomic",
					"raw",
					"result.json",
				),
			),
		).rejects.toThrow();
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

	it("rejects invalid scan IDs and keeps scoped cleanup inside its owner namespace", async () => {
		await expect(
			storage.saveLog("../outside", "stdout", "content"),
		).rejects.toThrow("Invalid scan run ID.");
		const left = storage.forToolRun("scan-123", "tool-left");
		const right = storage.forToolRun("scan-123", "tool-right");
		const rightArtifact = await right.saveLog("scan-123", "stdout", "right");
		await expect(left.removeArtifacts([rightArtifact.path])).rejects.toThrow(
			"Artifact owner cannot remove artifacts outside its namespace.",
		);
	});

	it("removes only a server-owned scan run directory", async () => {
		await storage.saveTextArtifact("scan-123", "reports", "content", "report.md");
		await storage.removeRunDirectory("scan-123");
		await expect(fs.stat(path.join(tempDir, "scan-123"))).rejects.toThrow();
		await expect(storage.removeRunDirectory("../outside")).rejects.toThrow(
			"Invalid scan run ID.",
		);
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

	it("hashes artifacts with the same size and boundary protections as reads", async () => {
		const saved = await storage.saveTextArtifact(
			"scan-123",
			"reports",
			"hash this report",
			"report.json",
		);
		expect(await storage.hashArtifact(saved.path, { maxBytes: 64 })).toEqual({
			sha256: saved.sha256,
			sizeBytes: saved.sizeBytes,
		});
		await expect(
			storage.hashArtifact(saved.path, { maxBytes: 5 }),
		).rejects.toThrow("configured read limit");

		const outside = path.resolve(tempDir, "..", "outside-hash-artifact.txt");
		const link = path.resolve(tempDir, "scan-123", "reports", "hash-escape.json");
		await fs.writeFile(outside, "outside");
		await fs.symlink(outside, link);
		try {
			await expect(
				storage.hashArtifact("scan-123/reports/hash-escape.json", {
					maxBytes: 64,
				}),
			).rejects.toThrow("symlink resolves outside");
		} finally {
			await fs.rm(outside, { force: true });
		}
	});
});
