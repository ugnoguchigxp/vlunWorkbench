import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BenchmarkMetric } from "../../shared/schemas/benchmark.schema";
import { BenchmarkRepository } from "../modules/benchmarks/benchmark-repository";
import { createDbConnection } from ".";
import { verifyPersistedBenchmarkRun } from "./benchmark-run-verifier";
import { migrateTestDatabase } from "./testing/migrate";

const digest = `sha256:${"a".repeat(64)}`;

describe("persisted benchmark run verifier", () => {
	test("binds the persisted input hash as well as metrics and provenance", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "benchmark-verifier-"));
		const databaseUrl = `file:${path.join(root, "benchmark.sqlite")}`;
		try {
			await migrateTestDatabase(databaseUrl);
			const connection = createDbConnection(databaseUrl, {
				shutdownWriterOnClose: true,
			});
			const repository = new BenchmarkRepository(connection.db);
			const run = await repository.create({
				corpusId: "owasp-benchmark-java",
				corpusVersion: "1.2beta",
				corpusDigest: digest,
				gitCommit: "a".repeat(40),
				toolboxImageDigest: digest,
				scannerManifestHash: digest,
				benchmarkPolicyVersion: "1.0.0",
				inputHash: digest,
			});
			await repository.start(run.id);
			const metrics: BenchmarkMetric[] = [
				{
					category: "overall",
					truePositive: 1,
					falseNegative: 0,
					trueNegative: 1,
					falsePositive: 0,
					recall: 1,
					precision: 1,
					falsePositiveRate: 0,
					score: 1,
				},
			];
			await repository.complete({
				runId: run.id,
				metrics,
				outputHash: digest,
			});
			connection.sqlite.close();

			const verification = {
				runId: run.id,
				databaseUrl,
				releaseCommit: "a".repeat(40),
				manifestHash: digest,
				policyVersion: "1.0.0",
				toolboxImageDigest: digest,
				runInputHash: digest,
				artifact: {
					corpusDigest: digest,
					outputHash: digest,
					rawScannerArtifactHash: digest,
					metrics,
				},
			};
			await expect(
				verifyPersistedBenchmarkRun(verification),
			).resolves.toBeUndefined();
			await expect(
				verifyPersistedBenchmarkRun({
					...verification,
					runInputHash: `sha256:${"b".repeat(64)}`,
				}),
			).rejects.toThrow("passing_benchmark_run_provenance_mismatch");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
