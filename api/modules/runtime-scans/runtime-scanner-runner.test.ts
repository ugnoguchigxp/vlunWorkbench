import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ArtifactStorage } from "../scans/artifact-storage";
import { RuntimeScannerRunner } from "./runtime-scanner-runner";

describe("RuntimeScannerRunner", () => {
	const roots: string[] = [];
	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
	});

	test("accepts Nuclei JSONL with zero or more findings and stores the artifact", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-scanner-test-"));
		roots.push(root);
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			const outputIndex = args.indexOf("-jsonl-export");
			const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
			const isVersion = args.includes("-version");
			const write = !isVersion && outputPath
				? fs.writeFile(outputPath, JSON.stringify({ "template-id": "exposed-env-file", host: "http://127.0.0.1:3000", info: { name: "Exposed env", severity: "high" } }) + "\n")
				: Promise.resolve();
			return {
				exited: write.then(() => 0),
				stdout: new ReadableStream({ start(controller) { controller.close(); } }),
				stderr: new ReadableStream({ start(controller) { controller.close(); } }),
			} as any;
		});
		const result = await new RuntimeScannerRunner("nuclei-safe", new ArtifactStorage(path.join(root, "artifacts"))).run({
			scanRunId: "scan-1",
			targetOrigin: "http://127.0.0.1:3000",
		});
		expect(result.ok).toBe(true);
		expect(result.findings).toHaveLength(1);
		expect(result.rawArtifact?.path).toContain("nuclei.jsonl");
	});
});
