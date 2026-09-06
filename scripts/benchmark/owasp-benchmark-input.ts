import { canonicalJson } from "../../api/modules/scans/diff-scan-plan";
import { sha256 } from "./benchmark-input-provenance";

// The producer and verifier must bind every detector, postprocessor and scorer
// to the same implementation. In particular, properties resolution changes
// whether a configured digest candidate becomes a finding.
export const OWASP_IMPLEMENTATION_PATHS = [
	"docker/toolbox/scanner-data/semgrep-rules/java",
	"scripts/benchmark/owasp-benchmark.ts",
	"scripts/benchmark/owasp-benchmark-input.ts",
	"scripts/benchmark/owasp-benchmark-runtime.ts",
	"scripts/benchmark/owasp-release-policy.ts",
	"api/modules/benchmarks/metric-scorer.ts",
	"api/modules/benchmarks/owasp-benchmark-adapter.ts",
	"api/modules/scans/tools/java-taint-precision-filter.ts",
	"api/modules/scans/tools/java-configured-hash-evaluator.ts",
	"api/modules/scans/tools/java-constant-flow.ts",
	"api/modules/scans/tools/java-constant-values.ts",
	"api/modules/scans/tools/java-flow-control.ts",
	"api/modules/scans/tools/java-helper-resolution.ts",
	"api/modules/scans/tools/java-source-analysis.ts",
	"api/modules/scans/tools/java-sink-proof.ts",
	"api/modules/scans/tools/java-project-model.ts",
	"api/modules/scans/tools/java-reflection-summary.ts",
	"api/modules/scans/tools/java-properties.ts",
	"bun.lock",
	"scripts/benchmark/benchmark-input-provenance.ts",
];

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
