import { describe, expect, test } from "bun:test";
import { owaspBenchmarkInputHash } from "./owasp-benchmark-input";

const digest = `sha256:${"a".repeat(64)}`;

describe("OWASP benchmark input hash", () => {
	test("binds every persisted scanner input", () => {
		const input = {
			corpusDigest: digest,
			expectedResultsHash: digest,
			findingsHash: digest,
			rawScannerArtifactHash: digest,
			scannerManifestHash: digest,
		};
		const initial = owaspBenchmarkInputHash(input);
		expect(initial).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(
			owaspBenchmarkInputHash({
				...input,
				findingsHash: `sha256:${"b".repeat(64)}`,
			}),
		).not.toBe(initial);
	});

	test("rejects a missing or malformed input digest", () => {
		expect(() =>
			owaspBenchmarkInputHash({
				corpusDigest: digest,
				expectedResultsHash: digest,
				findingsHash: undefined,
				rawScannerArtifactHash: digest,
				scannerManifestHash: digest,
			}),
		).toThrow("owasp_benchmark_input_hash_field_invalid:findingsHash");
	});
});
