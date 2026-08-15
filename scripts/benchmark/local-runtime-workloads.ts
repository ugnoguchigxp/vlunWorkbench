import { Hono } from "hono";
import { readAppEnv } from "../../api/app/env";
import { createLocalRuntimeDatabaseFixture } from "../../api/db/testing/connection";
import { WriterQueue } from "../../api/db/writer/queue";
import { requireAuth } from "../../api/middleware/auth";
import type { AuthService } from "../../api/modules/auth/auth.service";
import { generateAccessToken } from "../../api/modules/auth/token.service";
import { createHealthRoute } from "../../api/routes/health.route";
import { measure, type WorkloadObservation } from "./local-runtime-lib";

type MutableObservation = WorkloadObservation;

function observation(id: string): MutableObservation {
	return {
		id,
		durationsMs: [],
		operations: 0,
		elapsedMs: 0,
		maxQueueDepth: 0,
		errors: 0,
		rejections: 0,
	};
}

async function runRepeated(
	id: string,
	count: number,
	operation: () => unknown | Promise<unknown>,
): Promise<WorkloadObservation> {
	const result = observation(id);
	const startedAt = performance.now();
	for (let index = 0; index < count; index += 1) {
		try {
			const measured = await measure(operation);
			result.durationsMs.push(measured.durationMs);
			result.operations += 1;
		} catch {
			result.errors += 1;
		}
	}
	result.elapsedMs = performance.now() - startedAt;
	return result;
}

async function healthReadiness(samples: number): Promise<WorkloadObservation> {
	const fixture = createLocalRuntimeDatabaseFixture();
	const app = new Hono().route(
		"/health",
		createHealthRoute({
			env: readAppEnv({ NODE_ENV: "test" }),
			dbConnection: fixture.connection,
			expectedMigrations: [],
		}),
	);
	let index = 0;
	const result = await runRepeated("health_readiness", samples, async () => {
		const response = await app.request(
			index++ % 2 === 0 ? "/health" : "/health/ready",
		);
		if (response.status !== 200) throw new Error("Health endpoint failed.");
		await response.arrayBuffer();
	});
	fixture.close();
	return result;
}

async function authenticatedLists(
	samples: number,
): Promise<WorkloadObservation> {
	const env = readAppEnv({ NODE_ENV: "test" });
	const benchmarkUserId = "00000000-0000-4000-8000-000000000001";
	const token = await generateAccessToken(
		{
			userId: benchmarkUserId,
			email: "benchmark@example.invalid",
			role: "member",
		},
		env,
	);
	const authService = {
		findUserById: async () => ({
			id: benchmarkUserId,
			email: "benchmark@example.invalid",
			displayName: "Benchmark",
			passwordHash: "redacted",
			role: "member" as const,
			isActive: true,
			lastLoginAt: null,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		}),
	} as unknown as AuthService;
	const app = new Hono();
	app.use("*", requireAuth({ env, authService }));
	app.get("/projects", (context) =>
		context.json({ projects: [{ id: "p-1" }] }),
	);
	app.get("/scans", (context) => context.json({ scans: [{ id: "s-1" }] }));
	app.get("/findings", (context) =>
		context.json({ findings: [{ id: "f-1" }] }),
	);
	const paths = ["/projects", "/scans", "/findings"];
	let index = 0;
	return await runRepeated("authenticated_lists", samples, async () => {
		const response = await app.request(
			paths[index++ % paths.length] ?? "/projects",
			{
				headers: { authorization: `Bearer ${token}` },
			},
		);
		if (response.status !== 200) throw new Error("Authenticated list failed.");
		await response.arrayBuffer();
	});
}

async function writerMutations(
	concurrency: number,
	samples: number,
): Promise<WorkloadObservation> {
	const id =
		concurrency === 1 ? "writer_single" : `writer_concurrency_${concurrency}`;
	const result = observation(id);
	const fixture = createLocalRuntimeDatabaseFixture();
	const queue = new WriterQueue(10_000);
	const startedAt = performance.now();
	const enqueue = (index: number) => {
		const enqueuedAt = performance.now();
		const promise = queue.enqueue(() => fixture.insertMutation(`v-${index}`));
		result.maxQueueDepth = Math.max(result.maxQueueDepth, queue.depth);
		return promise.then(
			() => {
				result.durationsMs.push(performance.now() - enqueuedAt);
				result.operations += 1;
			},
			() => {
				result.rejections += 1;
			},
		);
	};
	if (concurrency === 1) {
		for (let index = 0; index < samples; index += 1) {
			await enqueue(index);
		}
	} else {
		await Promise.all(
			Array.from({ length: concurrency }, (_, index) => enqueue(index)),
		);
	}
	await queue.whenIdle();
	result.elapsedMs = performance.now() - startedAt;
	fixture.close();
	return result;
}

async function scanAdmission(samples: number): Promise<WorkloadObservation> {
	return await runRepeated(
		"scan_process_admission",
		Math.min(samples, 7),
		async () => {
			const child = Bun.spawn(
				[process.execPath, "-e", 'process.stdout.write("started")'],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const output = await new Response(child.stdout).text();
			if ((await child.exited) !== 0 || output !== "started") {
				throw new Error("Child process did not start.");
			}
		},
	);
}

async function databaseReads(samples: number): Promise<WorkloadObservation[]> {
	const fixture = createLocalRuntimeDatabaseFixture({
		populateReadFixtures: true,
	});
	const pagination = await runRepeated(
		"finding_10k_pagination",
		samples,
		() => {
			if (fixture.readFindingPage() !== 101) {
				throw new Error("Pagination fixture drifted.");
			}
		},
	);
	const intelligence = await runRepeated(
		"static_intelligence_current_read",
		samples,
		() => {
			if (fixture.readCurrentIntelligenceGeneration() !== 99) {
				throw new Error("Intelligence fixture drifted.");
			}
		},
	);
	fixture.close();
	return [pagination, intelligence];
}

async function diagnosticAdmission(
	samples: number,
): Promise<WorkloadObservation> {
	const result = observation("diagnostic_fixture_admission");
	const queue = new WriterQueue(10_000);
	const fixtureProvider = async () => ({ verdict: "fixture", findingCount: 0 });
	const startedAt = performance.now();
	await Promise.all(
		Array.from({ length: samples }, () => {
			const enqueuedAt = performance.now();
			const promise = queue.enqueue(fixtureProvider);
			result.maxQueueDepth = Math.max(result.maxQueueDepth, queue.depth);
			return promise.then(
				() => {
					result.durationsMs.push(performance.now() - enqueuedAt);
					result.operations += 1;
				},
				() => {
					result.rejections += 1;
				},
			);
		}),
	);
	result.elapsedMs = performance.now() - startedAt;
	return result;
}

export async function runLocalRuntimeWorkloads(
	samples: number,
): Promise<WorkloadObservation[]> {
	const reads = await databaseReads(samples);
	return [
		await healthReadiness(samples),
		await authenticatedLists(samples),
		await writerMutations(1, samples),
		await writerMutations(4, samples),
		await writerMutations(16, samples),
		await writerMutations(64, samples),
		await scanAdmission(samples),
		...reads,
		await diagnosticAdmission(samples),
	];
}
