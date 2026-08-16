import { describe, expect, test } from "bun:test";
import {
	buildPinnedSemgrepDockerCommand,
	buildPinnedSemgrepRepositoryCommand,
	containerCorpusPathToHost,
	hostCorpusPathToEvidencePath,
	pinnedImageDigest,
	repositoryRelativeEvidencePath,
	sanitizedSemgrepEvidenceArtifactSchema,
	sanitizeSemgrepEvidenceArtifact,
} from "./owasp-benchmark-runtime";

const digest = `sha256:${"a".repeat(64)}`;
const image = `docker.io/semgrep/semgrep@${digest}`;

describe("OWASP benchmark runtime", () => {
	test("builds a network-disabled, privilege-reduced pinned container command", () => {
		const command = buildPinnedSemgrepDockerCommand({
			image,
			expectedImageDigest: digest,
			repositoryRoot: "/workspace/repository",
			corpusSource: "/workspace/corpus",
			rawOutputPath: "/workspace/output/owasp-semgrep-raw.json",
		});
		expect(command.slice(0, 3)).toEqual(["docker", "run", "--rm"]);
		expect(command).toContain("none");
		expect(command).toContain("ALL");
		expect(command).toContain("no-new-privileges");
		expect(command).toContain(image);
		expect(command).toContain("/workspace/corpus");
		expect(command).toContain("--strict");
	});

	test("maps bounded container corpus paths back to host evidence", () => {
		expect(
			containerCorpusPathToHost(
				"/workspace/corpus/src/BenchmarkTest00001.java",
				"/tmp/corpus",
			),
		).toBe("/tmp/corpus/src/BenchmarkTest00001.java");
		expect(() =>
			containerCorpusPathToHost(
				"/workspace/corpus/../private.txt",
				"/tmp/corpus",
			),
		).toThrow("owasp_semgrep_container_result_path_invalid");
		expect(() =>
			containerCorpusPathToHost("/src/private.java", "/tmp/corpus"),
		).toThrow("owasp_semgrep_container_result_path_outside_corpus");
		expect(
			hostCorpusPathToEvidencePath(
				"/tmp/corpus/src/BenchmarkTest00001.java",
				"/tmp/corpus",
			),
		).toBe("corpus/src/BenchmarkTest00001.java");
		expect(
			hostCorpusPathToEvidencePath(
				"src/BenchmarkTest00002.java",
				"/tmp/corpus",
			),
		).toBe("corpus/src/BenchmarkTest00002.java");
		expect(
			repositoryRelativeEvidencePath(
				"/workspace/repository/.artifacts/result.json",
				"/workspace/repository",
			),
		).toBe(".artifacts/result.json");
	});

	test("removes host paths and source snippets from persisted Semgrep evidence", () => {
		const sanitized = sanitizeSemgrepEvidenceArtifact(
			{
				version: "1.171.0",
				errors: [],
				results: [
					{
						check_id: "owned.sql-injection",
						path: "/home/runner/corpus/src/BenchmarkTest00001.java",
						start: { line: 10, col: 2, offset: 30 },
						end: { line: 10, col: 8, offset: 36 },
						extra: {
							lines: "password = secretSource();",
							metavars: { $X: { abstract_content: "secretSource()" } },
							metadata: { cwe: ["CWE-89"], remediation: "private" },
						},
					},
				],
				vulnWorkbenchSuppressed: [
					{
						checkId: "owned.sql-injection",
						path: "/home/runner/corpus/src/BenchmarkTest00002.java",
						line: 12,
						reason: "constant_branch",
					},
				],
			},
			"/home/runner/corpus",
		);
		const serialized = JSON.stringify(sanitized);
		expect(serialized).not.toContain("/home/runner");
		expect(serialized).not.toContain("secretSource");
		expect(serialized).not.toContain("remediation");
		expect(sanitized.results[0]?.path).toBe(
			"corpus/src/BenchmarkTest00001.java",
		);
		expect(sanitized.vulnWorkbenchSuppressed[0]?.path).toBe(
			"corpus/src/BenchmarkTest00002.java",
		);
		expect(() =>
			sanitizedSemgrepEvidenceArtifactSchema.parse({
				...sanitized,
				results: [
					{
						...sanitized.results[0],
						sourceSnippet: "password = secretSource();",
					},
				],
			}),
		).toThrow();
	});

	test("runs repository contract checks in the same pinned image", () => {
		const command = buildPinnedSemgrepRepositoryCommand({
			image,
			expectedImageDigest: digest,
			repositoryRoot: "/workspace/repository",
			semgrepArguments: ["--test", "--strict", "--config", "rules"],
		});
		expect(command).toContain("--test");
		expect(command).toContain("/src");
		expect(command.some((argument) => argument.endsWith(",readonly"))).toBe(
			true,
		);
	});

	test("rejects tags and digest mismatches", () => {
		expect(() => pinnedImageDigest("semgrep/semgrep:latest")).toThrow(
			"owasp_semgrep_image_must_be_digest_pinned",
		);
		expect(() =>
			buildPinnedSemgrepDockerCommand({
				image,
				expectedImageDigest: `sha256:${"b".repeat(64)}`,
				repositoryRoot: "/workspace/repository",
				corpusSource: "/workspace/corpus",
				rawOutputPath: "/workspace/output/owasp-semgrep-raw.json",
			}),
		).toThrow("owasp_semgrep_image_digest_mismatch");
	});
});
