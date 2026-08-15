import { describe, expect, test } from "bun:test";
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
				osv: tool("osv-npm", "osv/osv-scanner/npm/all.zip"),
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
});

function tool(id: string, path: string) {
	return {
		version: "1.0.0",
		binaryDigest: null,
		runtimePath: null,
		state: "ready",
		dataBundles: [
			{
				id,
				kind: "vulnerability-db",
				sourceRef: "https://example.test/data",
				sourceCommit: null,
				license: "Apache-2.0",
				generatedAt: "2026-08-15T00:00:00.000Z",
				maxAgeHours: 168,
				digest: `sha256:${"1".repeat(64)}`,
				coverage: ["fixture"],
				path,
			},
		],
	};
}
