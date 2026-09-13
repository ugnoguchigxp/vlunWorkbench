import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { sha256 } from "./benchmark/benchmark-input-provenance";
import { verifySavedCapability } from "./verify-saved-capability";

test("saved evidence fails on tampering and traversal", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "saved-capability-"));
	try {
		const releaseCommit = "a".repeat(40);
		const payload = JSON.stringify({ releaseCommit });
		const report = "professional-capability-release-report.json";
		await writeFile(path.join(root, report), payload);
		const manifest = { releaseCommit, status: "passed", artifacts: { [report]: sha256(payload) } };
		await writeFile(path.join(root, "report.json"), JSON.stringify(manifest));
		expect((await verifySavedCapability(root)).verifiedArtifacts).toBe(1);
		await writeFile(path.join(root, report), "{}");
		await expect(verifySavedCapability(root)).rejects.toThrow("hash_mismatch");
		await writeFile(path.join(root, "report.json"), JSON.stringify({ ...manifest, artifacts: { "../outside": sha256(payload) } }));
		await expect(verifySavedCapability(root)).rejects.toThrow("path_invalid");
	} finally { await rm(root, { recursive: true, force: true }); }
});
