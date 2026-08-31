import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildScanExecutionEffectivenessBaseline } from "./scan-execution-effectiveness-baseline";

let temporaryDirectory: string | null = null;

afterEach(async () => {
	if (temporaryDirectory) {
		await fs.rm(temporaryDirectory, { recursive: true, force: true });
		temporaryDirectory = null;
	}
});

async function fixture() {
	temporaryDirectory = await fs.mkdtemp(
		path.join(os.tmpdir(), "scan-execution-baseline-"),
	);
	const storageKey = "scan-1/owners/tool-run/tool-1/raw/result.json";
	const content = Buffer.from('{"ok":true}\n');
	const artifactPath = path.join(temporaryDirectory, storageKey);
	await fs.mkdir(path.dirname(artifactPath), { recursive: true });
	await fs.writeFile(artifactPath, content);
	return {
		storageKey,
		sha256: createHash("sha256").update(content).digest("hex"),
		sizeBytes: content.byteLength,
	};
}

describe("scan execution effectiveness baseline", () => {
	test("records only safe, replayable run data and recomputes every artifact hash", async () => {
		const artifact = await fixture();
		const baseline = await buildScanExecutionEffectivenessBaseline({
			artifactRoot: temporaryDirectory!,
			generatedAt: "2026-08-21T00:00:00.000Z",
			snapshot: {
				run: {
					id: "scan-1",
					profile: "full-security-scan",
					status: "completed",
					profileOutcome: "completed_with_warnings",
					metadata: {
						secret: "must-not-be-retained",
						scanPreflight: {
							mode: "shadow",
							status: "blocked",
							preflightHash: `sha256:${"a".repeat(64)}`,
							sourceRevision: "e".repeat(40),
							binding: { sourceRevisionHash: `sha256:${"b".repeat(64)}` },
						},
					},
				},
				events: [{ seq: 1, level: "info", eventType: "scan.started" }],
				tools: [
					{
						toolName: "trivy",
						toolVersion: "Version: 0.71.2",
						status: "completed",
						exitCode: 0,
						metadata: {
							command: "must-not-be-retained",
							provenance: {
								manifestHash: `sha256:${"c".repeat(64)}`,
								toolVersion: "0.72.0",
								reproducible: true,
							},
						},
					},
				],
				artifacts: [
					{
						id: "artifact-1",
						kind: "raw_result",
						format: "json",
						storageKey: artifact.storageKey,
						sha256: artifact.sha256,
						sizeBytes: artifact.sizeBytes,
					},
				],
				coverage: [],
				reports: [],
				reviews: [],
			},
		});

		expect(baseline.artifacts[0]).toEqual(
			expect.objectContaining({
				sha256: `sha256:${artifact.sha256}`,
				recomputedSha256: `sha256:${artifact.sha256}`,
				recomputedSizeBytes: artifact.sizeBytes,
			}),
		);
		expect(JSON.stringify(baseline)).not.toContain("must-not-be-retained");
		expect(baseline.tools[0]?.provenance).toEqual({
			manifestHash: `sha256:${"c".repeat(64)}`,
			expectedVersion: "0.72.0",
			recordedReproducible: true,
		});
	});

	test("fails when persisted artifact bytes no longer match their recorded identity", async () => {
		const artifact = await fixture();
		await fs.writeFile(path.join(temporaryDirectory!, artifact.storageKey), "tampered");

		await expect(
			buildScanExecutionEffectivenessBaseline({
				artifactRoot: temporaryDirectory!,
				generatedAt: "2026-08-21T00:00:00.000Z",
				snapshot: {
					run: {
						id: "scan-1",
						profile: "baseline",
						status: "completed",
						profileOutcome: "completed",
						metadata: {},
					},
					events: [],
					tools: [],
					artifacts: [
						{
							id: "artifact-1",
							kind: "raw_result",
							format: "json",
							storageKey: artifact.storageKey,
							sha256: artifact.sha256,
							sizeBytes: artifact.sizeBytes,
						},
					],
					coverage: [],
					reports: [],
					reviews: [],
				},
			}),
		).rejects.toThrow("scan_execution_baseline_artifact_hash_mismatch:artifact-1");
	});
});
