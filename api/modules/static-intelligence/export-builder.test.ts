import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import { staticIntelligenceExportV1Schema } from "../../../shared/schemas/static-intelligence.schema";
import { buildStaticIntelligenceExport } from "./export-builder";

const NOW = new Date("2026-07-05T12:00:00.000Z");
const GENERATED_AT = new Date("2026-07-05T12:30:00.000Z");
const RAW_REVIEW_MARKER = "SECRET_REVIEW_BODY_SHOULD_NOT_LEAK";

describe("Static Intelligence export builder", () => {
	let connection: DbConnection;
	let userId: string;
	let projectId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "static-intel@example.com",
				passwordHash: "password",
				displayName: "Static Intel User",
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
				name: "Target Project",
				repoPath: "/workspace/target",
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		projectId = project.id;
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("builds a valid zero-finding export", async () => {
		const scanRunId = await seedScanRun();

		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: GENERATED_AT },
		);

		expect(() => staticIntelligenceExportV1Schema.parse(exportPayload)).not.toThrow();
		expect(exportPayload.fileRiskIndex).toEqual([]);
		expect(exportPayload.scanSummary.riskBand).toBe("none");
		expect(exportPayload.codeStructure).toBeUndefined();
		expect(exportPayload.graph.nodes.map((node) => node.kind)).toEqual([
			"project",
			"scan_run",
		]);
	});

	it("includes code structure enrichment only when a snapshot option is provided", async () => {
		const scanRunId = await seedScanRun();

		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{
				generatedAt: GENERATED_AT,
				codeStructureSnapshot: codeStructureSnapshotFixture(),
			},
		);

		expect(() => staticIntelligenceExportV1Schema.parse(exportPayload)).not.toThrow();
		expect(exportPayload.codeStructure).toMatchObject({
			status: "available",
			fileTagsByPath: {
				"src/app.ts": ["route", "handler", "source"],
			},
		});
		const serialized = JSON.stringify(exportPayload.codeStructure);
		expect(serialized).not.toContain("SECRET_CODE_STRUCTURE_SOURCE");
		expect(serialized).not.toContain("App");
	});

	it("indexes finding risk and links finding evidence to artifacts", async () => {
		const scanRunId = await seedFindingBackedScan();
		await seedCompletedScanReview(scanRunId);

		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: GENERATED_AT },
		);

		expect(exportPayload.fileRiskIndex).toHaveLength(1);
		expect(exportPayload.fileRiskIndex[0]).toMatchObject({
			path: "src/app.ts",
			findingCount: 1,
			maxSeverity: "high",
			evidenceQuality: "strong",
			scanners: ["semgrep"],
			ruleIds: ["typescript.express.xss"],
			verificationRefs: [],
		});
		expect(exportPayload.scan.reviewStatus).toBe("completed");
		expect(exportPayload.handoff?.title).toBe("Fix reflected XSS");

		const graphEdges = exportPayload.graph.edges.map((edge) => edge.kind);
		expect(graphEdges).toContain("evidenced_by");
		expect(graphEdges).toContain("stored_as");
		expect(graphEdges).toContain("located_in");
		expect(graphEdges).toContain("verified_by");
		expect(
			exportPayload.graph.nodes.some(
				(node) =>
					node.kind === "verification" &&
					node.sourceId === "verification_command:1",
			),
		).toBe(true);
	});

	it("degrades cleanly when scan review is missing", async () => {
		const scanRunId = await seedFindingBackedScan();

		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: GENERATED_AT },
		);

		expect(exportPayload.scan.reviewStatus).toBe("missing");
		expect(exportPayload.handoff).toBeUndefined();
		expect(exportPayload.scanSummary.degradedReasons).toContain(
			"completed scan review missing",
		);
	});

	it("reports a newer failed review even when an older completed review exists", async () => {
		const scanRunId = await seedFindingBackedScan();
		await seedCompletedScanReview(scanRunId);
		await seedFailedScanReview(scanRunId);

		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: GENERATED_AT },
		);

		expect(exportPayload.scan.reviewStatus).toBe("failed");
		expect(exportPayload.handoff?.title).toBe("Fix reflected XSS");
		expect(exportPayload.scanSummary.degradedReasons).toContain(
			"latest scan review failed",
		);
		expect(exportPayload.scanSummary.degradedReasons).not.toContain(
			"completed scan review missing",
		);
	});

	it("does not include evidence snippets or raw artifact metadata", async () => {
		const scanRunId = await seedFindingBackedScan({
			snippet: "const token = 'SECRET_TOKEN_SHOULD_NOT_LEAK';",
			artifactMetadata: {
				rawContent: "SECRET_ARTIFACT_CONTENT_SHOULD_NOT_LEAK",
			},
		});

		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: GENERATED_AT },
		);
		const serialized = JSON.stringify(exportPayload);

		expect(serialized).not.toContain("SECRET_TOKEN_SHOULD_NOT_LEAK");
		expect(serialized).not.toContain("SECRET_ARTIFACT_CONTENT_SHOULD_NOT_LEAK");
		expect(serialized).toContain("artifacts/semgrep.json");
	});

	it("redacts project roots and ignores raw review-only fields", async () => {
		const scanRunId = await seedFindingBackedScan();
		await seedCompletedScanReview(scanRunId, {
			rawReviewMarker: RAW_REVIEW_MARKER,
			acceptanceCriteria: [
				"Injected HTML is escaped.",
				"/workspace/target/src/app.ts is covered by a targeted test.",
			],
		});

		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: GENERATED_AT },
		);
		const serialized = JSON.stringify(exportPayload);

		expect(serialized).not.toContain("/workspace/target");
		expect(serialized).not.toContain(RAW_REVIEW_MARKER);
		expect(exportPayload.handoff?.acceptanceCriteria).toContain(
			"<project-root>/src/app.ts is covered by a targeted test.",
		);
	});

	it("produces deterministic sorted output", async () => {
		const scanRunId = await seedFindingBackedScan();
		await seedFinding({
			scanRunId,
			path: "src/aaa.ts",
			ruleId: "typescript.injection",
			severity: "critical",
			fingerprint: "fp-critical",
			title: "SQL injection",
		});

		const first = await buildStaticIntelligenceExport(connection.db, scanRunId, {
			generatedAt: GENERATED_AT,
		});
		const second = await buildStaticIntelligenceExport(connection.db, scanRunId, {
			generatedAt: GENERATED_AT,
		});

		expect(first).toEqual(second);
		expect(first.fileRiskIndex.map((entry) => entry.path)).toEqual([
			"src/aaa.ts",
			"src/app.ts",
		]);
		expect(first.graph.nodes.map((node) => node.id)).toEqual(
			[...first.graph.nodes.map((node) => node.id)].sort((a, b) =>
				a.localeCompare(b),
			),
		);
	});

	async function seedScanRun() {
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: new Date(NOW.getTime() + 5000),
				createdByUserId: userId,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		return scanRun.id;
	}

	async function seedFindingBackedScan(
		options: {
			snippet?: string;
			artifactMetadata?: Record<string, unknown>;
		} = {},
	) {
		const scanRunId = await seedScanRun();
		const [toolRun] = await connection.db
			.insert(toolRuns)
			.values({
				scanRunId,
				toolName: "semgrep",
				toolVersion: "1.100.0",
				command: "semgrep scan",
				status: "completed",
				exitCode: 0,
				startedAt: NOW,
				completedAt: new Date(NOW.getTime() + 4000),
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const [artifact] = await connection.db
			.insert(scanArtifacts)
			.values({
				scanRunId,
				toolRunId: toolRun.id,
				kind: "raw_result",
				format: "json",
				path: "artifacts/semgrep.json",
				sha256: "fake-sha",
				sizeBytes: 200,
				metadata: options.artifactMetadata ?? {},
				createdAt: NOW,
			})
			.returning();
		const findingId = await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			severity: "high",
			fingerprint: "fp-xss",
			title: "Reflected XSS",
		});
		await connection.db.insert(findingEvidences).values({
			findingId,
			kind: "source-location",
			title: "Source location",
			artifactId: artifact.id,
			location: { path: "src/app.ts", startLine: 12 },
			snippet: options.snippet ?? "res.send(req.query.name);",
			metadata: {},
			createdAt: NOW,
		});
		return scanRunId;
	}

	async function seedFinding(params: {
		scanRunId: string;
		path: string;
		ruleId: string;
		severity: string;
		fingerprint: string;
		title: string;
	}) {
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId: params.scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: params.ruleId,
				title: params.title,
				description: "User-controlled value reaches a dangerous sink.",
				severity: params.severity,
				confidence: "static",
				status: "open",
				primaryLocation: { path: params.path, startLine: 12 },
				fingerprint: params.fingerprint,
				metadata: {},
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		return finding.id;
	}

	async function seedCompletedScanReview(
		scanRunId: string,
		options: {
			rawReviewMarker?: string;
			acceptanceCriteria?: string[];
		} = {},
	) {
		await connection.db.insert(scanReviews).values({
			scanRunId,
			projectId,
			provider: "openai",
			model: "gpt-4o-mini",
			status: "completed",
			summary: options.rawReviewMarker
				? `Review completed. ${options.rawReviewMarker}`
				: "Review completed.",
			riskOverview: "High risk XSS finding.",
			priorityNotes: ["Fix the XSS first."],
			coverageNotes: [],
			falsePositiveHotspots: [],
			recommendedNextActions: ["Patch and test."],
			findingTriageHints: [],
			confidenceNotes: [],
			inputBundle: options.rawReviewMarker
				? { rawReviewMarker: options.rawReviewMarker }
				: {},
			output: buildScanReviewOutput(options),
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 1000),
			createdAt: NOW,
			updatedAt: NOW,
		});
	}

	async function seedFailedScanReview(scanRunId: string) {
		const failedAt = new Date(NOW.getTime() + 2000);
		await connection.db.insert(scanReviews).values({
			scanRunId,
			projectId,
			provider: "openai",
			model: "gpt-4o-mini",
			status: "failed",
			summary: null,
			riskOverview: null,
			priorityNotes: [],
			coverageNotes: [],
			falsePositiveHotspots: [],
			recommendedNextActions: [],
			findingTriageHints: [],
			confidenceNotes: [],
			inputBundle: {},
			output: {},
			errorMessage: "review generation failed",
			startedAt: failedAt,
			completedAt: new Date(failedAt.getTime() + 1000),
			createdAt: failedAt,
			updatedAt: failedAt,
		});
	}
});

function buildScanReviewOutput(
	options: {
		rawReviewMarker?: string;
		acceptanceCriteria?: string[];
	} = {},
) {
	return {
		summary: "Review completed.",
		riskOverview: "High risk XSS finding.",
		priorityNotes: ["Fix the XSS first."],
		coverageNotes: [],
		falsePositiveHotspots: [],
		recommendedNextActions: ["Patch and test."],
		findingTriageHints: [],
		confidenceNotes: [],
		improvementRequest: {
			title: "Fix reflected XSS",
			objective: "Escape user-controlled output before rendering.",
			scope: [
				"Stored scan evidence only.",
				...(options.rawReviewMarker ? [options.rawReviewMarker] : []),
			],
			priorityPlan: [],
			implementationTasks: [],
			acceptanceCriteria: options.acceptanceCriteria ?? [
				"Injected HTML is escaped.",
			],
			verificationCommands: ["bun test"],
			constraints: ["Do not add a new scanner."],
			nonGoals: ["Do not redesign the app."],
			handoffPrompt:
				options.rawReviewMarker ??
				"Fix the reflected XSS based on stored evidence.",
		},
	};
}

function codeStructureSnapshotFixture(): CodeStructureSnapshot {
	return {
		version: "v1",
		generatedAt: "2026-07-06T12:00:00.000Z",
		project: {
			rootRef:
				"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			rootPathIncluded: false,
		},
		status: "completed",
		degradedReasons: [],
		files: [
			{
				path: "src/app.ts",
				language: "typescript",
				moduleKind: "esm",
				tags: ["route", "handler", "source"],
				exportedSymbols: ["App"],
				imports: ["./secret", "hono"],
				packageImports: ["hono"],
				contentHash:
					"abcdef0000000000000000000000000000000000000000000000000000000000",
				parseStatus: "parsed",
				degradedReasons: ["SECRET_CODE_STRUCTURE_SOURCE"],
			},
		],
		edges: [],
		packages: [{ name: "hono", importedBy: ["src/app.ts"] }],
		summary: {
			fileCount: 1,
			parsedFileCount: 1,
			skippedFileCount: 0,
			importEdgeCount: 0,
			packageDependencyCount: 1,
			exportedSymbolCount: 1,
			routeFileCount: 1,
			handlerFileCount: 1,
			schemaFileCount: 0,
			workerFileCount: 0,
			testFileCount: 0,
			configFileCount: 0,
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
