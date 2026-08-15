import { computeScannerManifestHash } from "../api/modules/scans/tools/scanner-provenance";
import {
	type ScannerDataManifestV2,
	scannerDataManifestV2Schema,
} from "../shared/schemas/security-capability.schema";

export function buildRepositoryScannerDataLock(
	input: unknown,
): ScannerDataManifestV2 {
	const manifest = scannerDataManifestV2Schema.parse(structuredClone(input));
	for (const bundle of manifest.tools.osv?.dataBundles ?? []) {
		bundle.path = null;
	}
	for (const bundle of manifest.tools.trivy?.dataBundles ?? []) {
		bundle.path = null;
	}
	for (const bundle of manifest.tools["nuclei-safe"]?.dataBundles ?? []) {
		if (bundle.id === "nuclei-safe-owned-v1") {
			bundle.path = "../nuclei-safe-templates";
		}
	}
	const { manifestHash: _previousHash, ...hashInput } = manifest;
	return scannerDataManifestV2Schema.parse({
		...hashInput,
		manifestHash: computeScannerManifestHash(hashInput),
	});
}
