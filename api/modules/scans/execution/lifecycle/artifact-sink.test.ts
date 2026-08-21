import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactRepository } from "./artifact-repository";
import { ScanArtifactSink } from "./artifact-sink";
import { ArtifactStorage } from "./artifact-storage";

const root = path.join(process.cwd(), "artifacts", "artifact-sink-test");

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe("ScanArtifactSink", () => {
	it("writes a deterministic owner key and registers that exact key", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const repository = {
			createArtifact: async (input: Record<string, unknown>) => {
				calls.push(input);
				return { id: "artifact-1", ...input };
			},
		} as unknown as ArtifactRepository;
		const saved = await new ScanArtifactSink(
			new ArtifactStorage(root),
			repository,
			{ scanRunId: "scan-1", kind: "tool-run", id: "tool-1" },
		).saveText({ role: "stderr", format: "text", content: "redacted" });

		expect(saved.storageKey).toContain(
			"scan-1/owners/tool-run/tool-1/logs/stderr.log",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.storageKey).toBe(saved.storageKey);
		expect(calls[0]?.toolRunId).toBe("tool-1");
	});

	it("removes the newly written artifact when DB registration fails", async () => {
		const repository = {
			createArtifact: async () => {
				throw new Error("database unavailable");
			},
		} as unknown as ArtifactRepository;
		const storage = new ArtifactStorage(root);
		await expect(
			new ScanArtifactSink(storage, repository, {
				scanRunId: "scan-1",
				kind: "tool-run",
				id: "tool-1",
			}).saveText({ role: "raw_result", format: "json", content: "{}" }),
		).rejects.toThrow("database unavailable");
		await expect(
			fs.stat(
				path.join(
					root,
					"scan-1/owners/tool-run/tool-1/raw/raw_result.json",
				),
			),
		).rejects.toThrow();
	});

	it("preserves binary files in the role-specific directory", async () => {
		const sourcePath = path.join(root, "input.bin");
		await fs.mkdir(root, { recursive: true });
		await fs.writeFile(sourcePath, Buffer.from([0, 255, 1]));
		const repository = {
			createArtifact: async (input: Record<string, unknown>) => ({
				id: "artifact-2",
				...input,
			}),
		} as unknown as ArtifactRepository;
		const saved = await new ScanArtifactSink(
			new ArtifactStorage(root),
			repository,
			{ scanRunId: "scan-1", kind: "tool-run", id: "tool-1" },
		).saveFile({
			role: "sbom",
			format: "cyclonedx-json",
			sourcePath,
		});

		expect(saved.storageKey).toContain(
			"scan-1/owners/tool-run/tool-1/sbom/sbom.json",
		);
		await expect(
			fs.readFile(path.join(root, saved.storageKey)),
		).resolves.toEqual(Buffer.from([0, 255, 1]));
	});

	it("rejects a saved path outside the owner namespace", async () => {
		const repository = {
			createArtifact: async () => ({ id: "artifact-3" }),
		} as unknown as ArtifactRepository;
		await expect(
			new ScanArtifactSink(new ArtifactStorage(root), repository, {
				scanRunId: "scan-1",
				kind: "tool-run",
				id: "tool-1",
			}).registerSaved({
				role: "raw_result",
				format: "json",
				saved: { path: "scan-1/raw/result.json", sha256: "a", sizeBytes: 1 },
			}),
		).rejects.toThrow("declared owner");
	});
});
