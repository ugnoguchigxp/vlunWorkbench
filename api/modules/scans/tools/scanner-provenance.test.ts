import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	computeScannerManifestHash,
	hashTree,
	loadScannerDataManifest,
	resolveScannerProvenance,
} from "./scanner-provenance";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((root) =>
			fs.rm(root, { recursive: true, force: true }),
		),
	);
});

describe("scanner provenance", () => {
	it("validates the committed owned scanner data", async () => {
		const manifest = await loadScannerDataManifest();
		expect(manifest.tools.semgrep).toMatchObject({
			state: "ready",
			dataKind: "minimal-owned-ruleset",
			coverage: [
				"javascript:2-rules",
				"typescript:2-rules",
				"python:1-rule",
			],
		});
	});

	it("separates the owned reproducible rules from exploratory registry auto", async () => {
		await expect(
			resolveScannerProvenance({
				toolId: "semgrep",
				execution: { runner: "host" },
				config: "owned",
			}),
		).resolves.toMatchObject({
			reproducible: true,
			configSource: "owned-manifest",
		});
		await expect(
			resolveScannerProvenance({
				toolId: "semgrep",
				execution: { runner: "host" },
				config: "auto",
			}),
		).resolves.toMatchObject({
			reproducible: false,
			configSource: "semgrep-registry-auto",
		});
	});

	it("fails closed for missing offline data in Docker", async () => {
		await expect(
			resolveScannerProvenance({
				toolId: "osv",
				execution: { runner: "docker" },
			}),
		).rejects.toThrow("Offline scanner data is missing");
	});

	it("detects manifest and scanner data tampering", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-data-"));
		tempRoots.push(root);
		const rules = path.join(root, "rules");
		await fs.mkdir(rules);
		await fs.writeFile(path.join(rules, "rules.yml"), "rules: []\n");
		const input = {
			version: 1 as const,
			snapshotDate: "2026-07-30",
			tools: {
				semgrep: {
					version: "1",
					dataKind: "owned-ruleset",
					state: "ready" as const,
					path: "rules",
					runtimePath: "/rules",
					digest: await hashTree(rules),
				},
			},
		};
		const manifestPath = path.join(root, "scanner-data-manifest.json");
		await fs.writeFile(
			manifestPath,
			JSON.stringify({
				...input,
				manifestHash: computeScannerManifestHash(input),
			}),
		);
		await expect(loadScannerDataManifest(manifestPath)).resolves.toBeDefined();
		await fs.writeFile(path.join(rules, "rules.yml"), "rules: [tampered]\n");
		await expect(loadScannerDataManifest(manifestPath)).rejects.toThrow(
			"digest mismatch",
		);
	});
});
