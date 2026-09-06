import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { computeScannerManifestHash } from "../api/modules/scans/tools/scanner-provenance";
import { buildRepositoryScannerDataLock } from "./scanner-data-lock";

describe("repository scanner data lock", () => {
	test("removes image-only paths and recomputes the manifest hash", () => {
		const manifest = buildRepositoryScannerDataLock({
			version: 2,
			generatedAt: "2026-08-15T00:00:00.000Z",
			manifestHash: `sha256:${"0".repeat(64)}`,
			tools: {
				trivy: tool("trivy-db-v2", "trivy"),
				osv: tool("osv-npm", "osv/osv-scanner/npm/all.zip", "npm"),
				"nuclei-safe": tool(
					"nuclei-safe-owned-v1",
					"nuclei-safe-templates",
				),
			},
		});

		expect(manifest.tools.trivy.dataBundles[0]?.path).toBeNull();
		expect(manifest.tools.osv.dataBundles[0]?.path).toBeNull();
		expect(
			manifest.tools["nuclei-safe"].dataBundles[0]?.path,
		).toBe("../nuclei-safe-templates");
		const { manifestHash, ...hashInput } = manifest;
		expect(manifestHash).toBe(computeScannerManifestHash(hashInput));
	});

	test("requires every OSV archive source to name an immutable GCS generation", () => {
		expect(() =>
			buildRepositoryScannerDataLock({
				version: 2,
				generatedAt: "2026-08-15T00:00:00.000Z",
				manifestHash: `sha256:${"0".repeat(64)}`,
				tools: { osv: tool("osv-npm", "osv/npm/all.zip") },
			}),
		).toThrow("osv_snapshot_source_not_allowed");
	});

	test("pins the Trivy database to an immutable allowed OCI manifest", async () => {
		const manifest = JSON.parse(
			await readFile(
				new URL(
					"../docker/toolbox/scanner-data/scanner-data-manifest.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		const trivyBundle = manifest.tools.trivy.dataBundles.find(
			(bundle: { id: string }) => bundle.id === "trivy-db-v2",
		);
		expect(trivyBundle?.sourceRef).toMatch(
			/^ghcr\.io\/aquasecurity\/trivy-db@sha256:[a-f0-9]{64}$/,
		);
		const { manifestHash, ...hashInput } = manifest;
		expect(manifestHash).toBe(computeScannerManifestHash(hashInput));

		const preparation = await readFile(
			new URL("./prepare-scanner-data.ts", import.meta.url),
			"utf8",
		);
		expect(preparation).toContain('"--db-repository"');
		expect(preparation).toContain("assertAllowedTrivyDatabaseSource");
		expect(preparation).toContain("let recordCount = allowRefresh");
		expect(preparation).toContain("? new Date().toISOString()");
		expect(preparation).toContain(": template.generatedAt");
	});
});

function tool(id: string, path: string, osvEcosystem?: string) {
	return {
		version: "1.0.0",
		binaryDigest: null,
		runtimePath: null,
		state: "ready",
		dataBundles: [
			{
				id,
				kind: "vulnerability-db",
				sourceRef: osvEcosystem
					? `https://osv-vulnerabilities.storage.googleapis.com/${osvEcosystem}/all.zip?generation=1788665539029532`
					: "https://example.test/data",
				sourceCommit: null,
				license: "Apache-2.0",
				generatedAt: "2026-08-15T00:00:00.000Z",
				maxAgeHours: 168,
				digest: `sha256:${"1".repeat(64)}`,
				coverage: [osvEcosystem ?? "fixture"],
				path,
			},
		],
	};
}
