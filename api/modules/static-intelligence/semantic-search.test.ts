import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanReviews,
	scanRuns,
	toolRuns,
	users,
} from "../../db/schema";
import type { EmbeddingProvider } from "../../providers/types";
import type { StaticIntelligenceEmbeddingSource } from "../../../shared/schemas/static-intelligence-search.schema";
import { buildStaticIntelligenceExport } from "./export-builder";
import { buildStaticIntelligenceEmbeddingSources } from "./embedding-source-builder";
import {
	ensureEmbeddingShape,
	StaticIntelligenceEmbeddingRepository,
} from "./embedding-repository";
import { indexStaticIntelligenceEmbeddings } from "./embedding-indexer";
import { StaticIntelligenceRepository } from "./repository";
import { runStaticIntelligenceSemanticQuery } from "./semantic-query";

const NOW = new Date("2026-07-05T12:00:00.000Z");
const SECRET_SNIPPET = "SECRET_SNIPPET_SHOULD_NOT_BE_EMBEDDED";

describe("Static Intelligence semantic search", () => {
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let seededFindingId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "static-search@example.com",
				passwordHash: "password",
				displayName: "Static Search User",
				role: "member",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		userId = user.id;
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "Search Target",
				repoPath: "/workspace/search-target",
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		projectId = project.id;
		const seeded = await seedFindingBackedScan();
		scanRunId = seeded.scanRunId;
		seededFindingId = seeded.findingId;
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("builds deterministic sanitized embedding sources", async () => {
		const first = await buildSources();
		const second = await buildSources();

		expect(first).toEqual(second);
		expect(first.map((source) => `${source.sourceKind}:${source.sourceRef}`)).toEqual(
			[...first.map((source) => `${source.sourceKind}:${source.sourceRef}`)].sort(
				(a, b) => a.localeCompare(b),
			),
		);
		const serialized = JSON.stringify(first);
		expect(serialized).not.toContain(SECRET_SNIPPET);
		expect(serialized).not.toContain("raw artifact content");
		expect(first.every((source) => source.metadata.candidateOnly)).toBe(true);
	});

	it("detects skipped, stale, model, dimension, and deleted rows", async () => {
		const provider = new FakeEmbeddingProvider();

		const first = await indexStaticIntelligenceEmbeddings({
			db: connection.db,
			scanRunId,
			embeddingProvider: provider,
			options: { embeddingModel: "model-a" },
		});
		expect(first.indexed).toBeGreaterThan(0);
		expect(first.skipped).toBe(0);

		const second = await indexStaticIntelligenceEmbeddings({
			db: connection.db,
			scanRunId,
			embeddingProvider: provider,
			options: { embeddingModel: "model-a" },
		});
		expect(second.indexed).toBe(0);
		expect(second.staleReplaced).toBe(0);
		expect(second.skipped).toBe(first.indexed);

		await connection.db
			.update(findings)
			.set({ title: "Updated Auth Boundary Finding", updatedAt: NOW })
			.where(eq(findings.id, seededFindingId));
		const changedContent = await indexStaticIntelligenceEmbeddings({
			db: connection.db,
			scanRunId,
			embeddingProvider: provider,
			options: { embeddingModel: "model-a" },
		});
		expect(changedContent.staleReplaced).toBeGreaterThan(0);

		const changedModel = await indexStaticIntelligenceEmbeddings({
			db: connection.db,
			scanRunId,
			embeddingProvider: provider,
			options: { embeddingModel: "model-b" },
		});
		expect(changedModel.staleReplaced).toBe(first.indexed);

		const changedDim = await indexStaticIntelligenceEmbeddings({
			db: connection.db,
			scanRunId,
			embeddingProvider: new FakeEmbeddingProvider(8),
			options: { embeddingModel: "model-b", embeddingDim: 8 },
		});
		expect(changedDim.staleReplaced).toBe(first.indexed);

		await connection.db.delete(findingEvidences);
		await connection.db.delete(findings);
		const deleted = await indexStaticIntelligenceEmbeddings({
			db: connection.db,
			scanRunId,
			embeddingProvider: provider,
			options: { embeddingModel: "model-a" },
		});
		expect(deleted.deleted).toBeGreaterThan(0);
	});

	it("validates embedding shape", () => {
		expect(() => ensureEmbeddingShape(vectorWithAxis(0))).not.toThrow();
		expect(() => ensureEmbeddingShape([1, 2, 3])).toThrow(
			"Embedding dimension mismatch",
		);
		const invalid = vectorWithAxis(0);
		invalid[1] = Number.NaN;
		expect(() => ensureEmbeddingShape(invalid)).toThrow(
			"Invalid embedding values.",
		);
	});

	it("uses sqlite-vec search and preserves refs", async () => {
		const repository = new StaticIntelligenceEmbeddingRepository(connection.db);
		await repository.replaceEmbeddingRow({
			source: {
				projectId,
				scanRunId,
				sourceKind: "file_risk_summary",
				sourceId: "src/auth.ts",
				sourceRef: "file:src/auth.ts",
				title: "Auth risk",
				content: "authorization boundary input validation",
				contentHash: "hash-auth",
				metadata: {
					filePath: "src/auth.ts",
					findingIds: ["finding-auth"],
					evidenceRefs: ["evidence-auth"],
					artifactRefs: ["artifact-auth"],
					candidateOnly: true,
				},
			},
			embedding: vectorWithAxis(0),
			embeddingModel: "fake",
		});
		await repository.replaceEmbeddingRow({
			source: {
				projectId,
				scanRunId,
				sourceKind: "file_risk_summary",
				sourceId: "src/db.ts",
				sourceRef: "file:src/db.ts",
				title: "Database risk",
				content: "sql query construction",
				contentHash: "hash-db",
				metadata: {
					filePath: "src/db.ts",
					findingIds: ["finding-db"],
					candidateOnly: true,
				},
			},
			embedding: vectorWithAxis(1),
			embeddingModel: "fake",
		});

		const rows = await repository.vectorSearch({
			scanRunId,
			embedding: vectorWithAxis(0),
			limit: 2,
		});

		expect(rows[0]?.sourceRef).toBe("file:src/auth.ts");
		expect(rows[0]?.vectorScore).toBeGreaterThan(rows[1]?.vectorScore ?? 0);
	});

	it("keeps the previous embedding row if stale replacement insert fails", async () => {
		const repository = new StaticIntelligenceEmbeddingRepository(connection.db);
		const source: StaticIntelligenceEmbeddingSource = {
			projectId,
			scanRunId,
			sourceKind: "file_risk_summary" as const,
			sourceId: "src/auth.ts",
			sourceRef: "file:src/auth.ts",
			title: "Auth risk",
			content: "authorization boundary input validation",
			contentHash: "hash-auth",
			metadata: {
				filePath: "src/auth.ts",
				findingIds: ["finding-auth"],
				candidateOnly: true,
			},
		};
		await repository.replaceEmbeddingRow({
			source,
			embedding: vectorWithAxis(0),
			embeddingModel: "fake",
		});

		await expect(
			repository.replaceEmbeddingRow({
				source: {
					...source,
					projectId: "00000000-0000-4000-8000-000000000099",
					contentHash: "hash-auth-updated",
					content: "updated content",
				},
				embedding: vectorWithAxis(1),
				embeddingModel: "fake",
			}),
		).rejects.toThrow();

		const rows = await repository.vectorSearch({
			scanRunId,
			embedding: vectorWithAxis(0),
			limit: 1,
		});
		expect(rows[0]).toMatchObject({
			sourceRef: "file:src/auth.ts",
			contentHash: "hash-auth",
			content: "authorization boundary input validation",
		});
	});

	it("applies hybrid filters and keeps candidate-only results", async () => {
		const repository = new StaticIntelligenceEmbeddingRepository(connection.db);
		await repository.replaceEmbeddingRow({
			source: {
				projectId,
				scanRunId,
				sourceKind: "finding",
				sourceId: "finding-auth",
				sourceRef: "finding:finding-auth",
				title: "Auth input validation",
				content: "authorization boundary input validation",
				contentHash: "hash-auth-finding",
				metadata: {
					filePath: "src/auth.ts",
					ruleId: "auth.rule",
					scanner: "semgrep",
					findingIds: ["finding-auth"],
					evidenceRefs: ["evidence-auth"],
					candidateOnly: true,
				},
			},
			embedding: vectorWithAxis(0),
			embeddingModel: "fake",
		});
		await repository.replaceEmbeddingRow({
			source: {
				projectId,
				scanRunId,
				sourceKind: "finding",
				sourceId: "finding-db",
				sourceRef: "finding:finding-db",
				title: "SQL query",
				content: "sql query construction",
				contentHash: "hash-db-finding",
				metadata: {
					filePath: "src/db.ts",
					ruleId: "db.rule",
					scanner: "semgrep",
					findingIds: ["finding-db"],
					candidateOnly: true,
				},
			},
			embedding: vectorWithAxis(1),
			embeddingModel: "fake",
		});

		const result = await runStaticIntelligenceSemanticQuery({
			db: connection.db,
			scanRunId,
			query: "auth input validation",
			embeddingProvider: new FixedEmbeddingProvider(vectorWithAxis(0)),
			options: {
				topK: 5,
				filters: { file: "src/auth.ts", ruleId: "auth.rule" },
			},
		});

		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toMatchObject({
			sourceRef: "finding:finding-auth",
			candidateOnly: true,
			relatedFindingIds: ["finding-auth"],
			evidenceRefs: ["evidence-auth"],
			filePath: "src/auth.ts",
		});
		expect(result.results[0]?.exactScore).toBeGreaterThan(0);
		expect(JSON.stringify(result.results)).not.toContain("confirmed");
	});

	it("returns a degraded empty result without auto-indexing", async () => {
		const emptyScanRunId = await seedScanRun();
		const result = await runStaticIntelligenceSemanticQuery({
			db: connection.db,
			scanRunId: emptyScanRunId,
			query: "auth risk",
			options: { topK: 3 },
		});

		expect(result.results).toEqual([]);
		expect(result.degradedReasons).toContain(
			"static intelligence embedding index is empty",
		);
	});

	it("returns a distinct degraded reason when filters match no indexed rows", async () => {
		await indexStaticIntelligenceEmbeddings({
			db: connection.db,
			scanRunId,
			embeddingProvider: new FakeEmbeddingProvider(),
			options: { embeddingModel: "model-a" },
		});

		const result = await runStaticIntelligenceSemanticQuery({
			db: connection.db,
			scanRunId,
			query: "auth risk",
			options: { topK: 3, filters: { file: "src/missing.ts" } },
		});

		expect(result.results).toEqual([]);
		expect(result.degradedReasons).toContain(
			"no static intelligence embedding rows matched the provided filters",
		);
	});

	async function buildSources() {
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: NOW },
		);
		const bundle = await new StaticIntelligenceRepository(
			connection.db,
		).loadSourceBundle(scanRunId);
		if (!bundle) throw new Error("bundle missing");
		return buildStaticIntelligenceEmbeddingSources(exportPayload, bundle);
	}

	async function seedScanRun() {
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: NOW,
				createdByUserId: userId,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		return scanRun.id;
	}

	async function seedFindingBackedScan() {
		const id = await seedScanRun();
		const [toolRun] = await connection.db
			.insert(toolRuns)
			.values({
				scanRunId: id,
				toolName: "semgrep",
				toolVersion: "1.0.0",
				command: "semgrep scan",
				status: "completed",
				exitCode: 0,
				startedAt: NOW,
				completedAt: NOW,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const [artifact] = await connection.db
			.insert(scanArtifacts)
			.values({
				scanRunId: id,
				toolRunId: toolRun.id,
				kind: "raw_result",
				format: "json",
				path: "artifacts/semgrep.json",
				sha256: "sha",
				sizeBytes: 100,
				metadata: { rawContent: "raw artifact content" },
				createdAt: NOW,
			})
			.returning();
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId: id,
				projectId,
				sourceTool: "semgrep",
				ruleId: "auth.rule",
				title: "Auth boundary issue",
				description: "Authorization boundary lacks input validation.",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/auth.ts", startLine: 10 },
				fingerprint: "fp-auth",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		await connection.db.insert(findingEvidences).values({
			findingId: finding.id,
			kind: "source-location",
			title: "Auth source location",
			artifactId: artifact.id,
			location: { path: "src/auth.ts", startLine: 10 },
			snippet: SECRET_SNIPPET,
			metadata: {},
			createdAt: NOW,
		});
		await connection.db.insert(scanReviews).values({
			scanRunId: id,
			projectId,
			provider: "openai",
			model: "gpt-4o-mini",
			status: "completed",
			summary: "Review found auth boundary risk.",
			riskOverview: "Input validation and authorization should be reviewed.",
			priorityNotes: ["Auth first."],
			coverageNotes: ["Static evidence only."],
			falsePositiveHotspots: [],
			recommendedNextActions: ["Patch authorization guard."],
			findingTriageHints: [],
			confidenceNotes: [],
			inputBundle: {},
			output: scanReviewOutput(finding.id),
			startedAt: NOW,
			completedAt: NOW,
			createdAt: NOW,
			updatedAt: NOW,
		});
			return { scanRunId: id, findingId: finding.id };
		}
	});

class FakeEmbeddingProvider implements EmbeddingProvider {
	constructor(private readonly dimensions = 1536) {}

	async createEmbedding(input: string): Promise<number[]> {
		const vector = new Array(this.dimensions).fill(0);
		const axis = input.toLowerCase().includes("auth") ? 0 : 1;
		vector[Math.min(axis, this.dimensions - 1)] = 1;
		return vector;
	}
}

class FixedEmbeddingProvider implements EmbeddingProvider {
	constructor(private readonly embedding: number[]) {}

	async createEmbedding(): Promise<number[]> {
		return this.embedding;
	}
}

function vectorWithAxis(axis: number): number[] {
	const vector = new Array(1536).fill(0);
	vector[axis] = 1;
	return vector;
}

function scanReviewOutput(findingId: string) {
	return {
		summary: "Review found auth boundary risk.",
		riskOverview: "Input validation and authorization should be reviewed.",
		priorityNotes: ["Auth first."],
		coverageNotes: ["Static evidence only."],
		falsePositiveHotspots: [],
		recommendedNextActions: ["Patch authorization guard."],
		findingTriageHints: [],
		confidenceNotes: [],
		improvementRequest: {
			title: "Patch auth validation",
			objective: "Improve authorization boundary input validation.",
			scope: ["Stored scan evidence only."],
			priorityPlan: [
				{
					priority: "high",
					rationale: "Auth boundary risk.",
					findingIds: [findingId],
				},
			],
			implementationTasks: [
				{
					title: "Patch guard",
					body: "Tighten validation before authorization decisions.",
					findingIds: [findingId],
					evidenceRefs: ["src/auth.ts:10"],
				},
			],
			acceptanceCriteria: ["Unauthorized input is rejected."],
			verificationCommands: ["bun test"],
			constraints: ["Do not add new scanners."],
			nonGoals: ["Do not create confirmed findings from semantic search."],
			handoffPrompt: "Patch auth validation using stored evidence.",
		},
	};
}

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of sqlFiles) {
		const sqlPath = path.resolve(migrationsDir, filename);
		connection.sqlite.exec(readFileSync(sqlPath, "utf8"));
	}
}
