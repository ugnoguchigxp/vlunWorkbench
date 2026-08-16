import { canonicalJson } from "../../api/modules/scans/diff-scan-plan";
import { sha256 } from "./benchmark-input-provenance";

export type OwaspBenchmarkInputEvidence = {
	corpusDigest?: string;
	expectedResultsHash?: string;
	findingsHash?: string;
	rawScannerArtifactHash?: string | null;
	scannerManifestHash?: string;
};

export function owaspBenchmarkInputHash(
	input: OwaspBenchmarkInputEvidence,
): string {
	for (const key of [
		"corpusDigest",
		"expectedResultsHash",
		"findingsHash",
		"rawScannerArtifactHash",
		"scannerManifestHash",
	] as const) {
		const value = input[key];
		if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
			throw new Error(`owasp_benchmark_input_hash_field_invalid:${key}`);
		}
	}
	return sha256(
		canonicalJson({
			corpusDigest: input.corpusDigest,
			expectedResultsHash: input.expectedResultsHash,
			findingsHash: input.findingsHash,
			rawScannerArtifactHash: input.rawScannerArtifactHash,
			scannerManifestHash: input.scannerManifestHash,
		}),
	);
}
