import { asc, eq } from "drizzle-orm";
import type { BenchmarkMetric } from "../../shared/schemas/benchmark.schema";
import { createDbConnection } from ".";
import {
	securityCapabilityBenchmarkMetrics,
	securityCapabilityBenchmarkRuns,
} from "./schema";

export async function verifyPersistedBenchmarkRun(params: {
	runId: string;
	databaseUrl?: string;
	releaseCommit: string;
	manifestHash: string;
	policyVersion: string;
	toolboxImageDigest?: string;
	runInputHash: string;
	artifact: {
		corpusDigest?: string;
		outputHash?: string;
		rawScannerArtifactHash?: string | null;
		metrics: BenchmarkMetric[];
	} | null;
}): Promise<void> {
	if (!params.databaseUrl)
		throw new Error("passing_benchmark_database_required");
	if (!params.toolboxImageDigest)
		throw new Error("passing_benchmark_toolbox_digest_required");
	let connection: ReturnType<typeof createDbConnection>;
	try {
		connection = createDbConnection(params.databaseUrl, {
			shutdownWriterOnClose: true,
		});
	} catch {
		throw new Error("passing_benchmark_database_unavailable");
	}
	try {
		const [run] = await connection.db
			.select({
				corpusId: securityCapabilityBenchmarkRuns.corpusId,
				corpusDigest: securityCapabilityBenchmarkRuns.corpusDigest,
				inputHash: securityCapabilityBenchmarkRuns.inputHash,
				gitCommit: securityCapabilityBenchmarkRuns.gitCommit,
				scannerManifestHash:
					securityCapabilityBenchmarkRuns.scannerManifestHash,
				toolboxImageDigest: securityCapabilityBenchmarkRuns.toolboxImageDigest,
				benchmarkPolicyVersion:
					securityCapabilityBenchmarkRuns.benchmarkPolicyVersion,
				status: securityCapabilityBenchmarkRuns.status,
				outputHash: securityCapabilityBenchmarkRuns.outputHash,
			})
			.from(securityCapabilityBenchmarkRuns)
			.where(eq(securityCapabilityBenchmarkRuns.id, params.runId))
			.limit(1);
		if (!run) throw new Error("passing_benchmark_run_not_found");
		if (
			run.corpusId !== "owasp-benchmark-java" ||
			run.status !== "completed" ||
			run.gitCommit !== params.releaseCommit ||
			run.scannerManifestHash !== params.manifestHash ||
			run.toolboxImageDigest !== params.toolboxImageDigest ||
			run.benchmarkPolicyVersion !== params.policyVersion ||
			run.corpusDigest !== params.artifact?.corpusDigest ||
			run.outputHash !== params.artifact?.outputHash ||
			run.inputHash !== params.runInputHash ||
			typeof params.artifact?.rawScannerArtifactHash !== "string"
		)
			throw new Error("passing_benchmark_run_provenance_mismatch");
		const persistedMetrics = await connection.db
			.select({
				category: securityCapabilityBenchmarkMetrics.category,
				truePositive: securityCapabilityBenchmarkMetrics.truePositive,
				falseNegative: securityCapabilityBenchmarkMetrics.falseNegative,
				trueNegative: securityCapabilityBenchmarkMetrics.trueNegative,
				falsePositive: securityCapabilityBenchmarkMetrics.falsePositive,
				recall: securityCapabilityBenchmarkMetrics.recall,
				precision: securityCapabilityBenchmarkMetrics.precision,
				falsePositiveRate: securityCapabilityBenchmarkMetrics.falsePositiveRate,
				score: securityCapabilityBenchmarkMetrics.score,
			})
			.from(securityCapabilityBenchmarkMetrics)
			.where(eq(securityCapabilityBenchmarkMetrics.runId, params.runId))
			.orderBy(asc(securityCapabilityBenchmarkMetrics.category));
		const artifactMetrics = [...(params.artifact?.metrics ?? [])].sort(
			(left, right) => left.category.localeCompare(right.category),
		);
		if (
			persistedMetrics.length === 0 ||
			JSON.stringify(persistedMetrics) !== JSON.stringify(artifactMetrics)
		)
			throw new Error("passing_benchmark_metric_mismatch");
	} finally {
		connection.sqlite.close();
	}
}
