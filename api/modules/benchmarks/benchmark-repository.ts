import { eq } from "drizzle-orm";
import type {
	BenchmarkMetric,
	BenchmarkRunInput,
} from "../../../shared/schemas/benchmark.schema";
import type { AppDatabase } from "../../db";
import {
	securityCapabilityBenchmarkMetrics,
	securityCapabilityBenchmarkRuns,
} from "../../db/schema";

export class BenchmarkRepository {
	constructor(private readonly db: AppDatabase) {}

	async create(input: BenchmarkRunInput) {
		const now = new Date();
		const [created] = await this.db
			.insert(securityCapabilityBenchmarkRuns)
			.values({
				...input,
				status: "queued",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async start(runId: string) {
		const [updated] = await this.db
			.update(securityCapabilityBenchmarkRuns)
			.set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
			.where(eq(securityCapabilityBenchmarkRuns.id, runId))
			.returning();
		return updated ?? null;
	}

	async complete(params: {
		runId: string;
		metrics: BenchmarkMetric[];
		outputHash: string;
		metricsArtifactId?: string | null;
	}) {
		for (const metric of params.metrics) {
			await this.db
				.insert(securityCapabilityBenchmarkMetrics)
				.values({ runId: params.runId, ...metric })
				.onConflictDoUpdate({
					target: [
						securityCapabilityBenchmarkMetrics.runId,
						securityCapabilityBenchmarkMetrics.category,
					],
					set: metric,
				});
		}
		await this.db
			.update(securityCapabilityBenchmarkRuns)
			.set({
				status: "completed",
				outputHash: params.outputHash,
				metricsArtifactId: params.metricsArtifactId ?? null,
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(securityCapabilityBenchmarkRuns.id, params.runId));
		return await this.find(params.runId);
	}

	async fail(
		runId: string,
		errorCode: string,
		status: "failed" | "inconclusive" = "failed",
	) {
		const [updated] = await this.db
			.update(securityCapabilityBenchmarkRuns)
			.set({
				status,
				errorCode,
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(securityCapabilityBenchmarkRuns.id, runId))
			.returning();
		return updated ?? null;
	}

	async find(runId: string) {
		const run = await this.db.query.securityCapabilityBenchmarkRuns.findFirst({
			where: eq(securityCapabilityBenchmarkRuns.id, runId),
		});
		if (!run) return null;
		const metrics =
			await this.db.query.securityCapabilityBenchmarkMetrics.findMany({
				where: eq(securityCapabilityBenchmarkMetrics.runId, runId),
				orderBy: (fields, { asc }) => [asc(fields.category)],
			});
		return { run, metrics };
	}
}
