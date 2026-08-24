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
			dataKind: "ruleset",
			coverage: [
				"javascript:8-rules",
				"typescript:8-rules",
				"python:8-rules",
				"java:13-rules",
				"go:8-rules",
				"source-and-license-lock",
			],
		});
		expect(manifest).toMatchObject({ version: 2, legacyManifest: false });
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
				config: "curated-sast-v1",
			}),
		).resolves.toMatchObject({
			reproducible: true,
			configSource: "curated-manifest",
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
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-data-missing-"));
		tempRoots.push(root);
		const input = {
			version: 1 as const,
			snapshotDate: "2026-07-30",
			tools: {
				osv: {
					version: "2.4.0",
					dataKind: "vulnerability-db",
					state: "missing" as const,
					path: null,
					runtimePath: "/scanner-data/osv",
					digest: null,
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
		await expect(
			resolveScannerProvenance({
				toolId: "osv",
				execution: { runner: "docker" },
				manifestPath,
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

	it("hashes a locked scanner data file by its bytes", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-data-file-"));
		tempRoots.push(root);
		const trustedRoot = path.join(root, "trusted-root.json");
		await fs.writeFile(trustedRoot, "{\"trusted\":true}\n");
		expect(await hashTree(trustedRoot)).toBe(
			"sha256:89de26c0daa8011ba50c71e343d6fdc7f73e4ea484cc15b3bf69d84ee8a29ecd",
		);
	});

	it("reads v1 for one release cycle with reproducibility limitations", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-data-v1-"));
		tempRoots.push(root);
		const input = {
			version: 1 as const,
			snapshotDate: "2026-07-30",
			tools: {
				semgrep: {
					version: "1",
					dataKind: "owned-ruleset",
					state: "ready" as const,
					path: null,
					runtimePath: "/rules",
					digest: null,
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
		await expect(loadScannerDataManifest(manifestPath)).resolves.toMatchObject({
			version: 1,
			legacyManifest: true,
		});
		await expect(
			resolveScannerProvenance({
				toolId: "semgrep",
				execution: { runner: "host" },
				config: "owned",
				manifestPath,
			}),
		).resolves.toMatchObject({
			legacyManifest: true,
			reproducible: false,
		});
	});
});
