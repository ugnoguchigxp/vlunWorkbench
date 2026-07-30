import path from "node:path";
import {
	loadScannerDataManifest,
	resolveScannerProvenance,
} from "../api/modules/scans/tools/scanner-provenance";

const manifestPath = path.resolve(
	process.cwd(),
	"docker/toolbox/scanner-data/scanner-data-manifest.json",
);
const manifest = await loadScannerDataManifest(manifestPath);
const matrix = await Promise.all(
	Object.keys(manifest.tools).map(async (toolId) => {
		const provenance = await resolveScannerProvenance({
			toolId,
			execution: { runner: "host" },
			config: toolId === "semgrep" ? "owned" : undefined,
			manifestPath,
		});
		return {
			toolId,
			state: provenance.dataState,
			digest: provenance.dataDigest,
			reproducible: provenance.reproducible,
		};
	}),
);
console.log(
	JSON.stringify({
		ok: true,
		manifestHash: manifest.manifestHash,
		snapshotDate: manifest.snapshotDate,
		matrix,
	}),
);
