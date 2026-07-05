import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
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
import { runStaticIntelligenceAgentQuery } from "./agent-query";

const NOW = new Date("2026-07-05T12:00:00.000Z");
const GENERATED_AT = new Date("2026-07-05T12:30:00.000Z");

describe("Static Intelligence agent query service", () => {
	let connection: DbConnection;
	let userId: string;
	let projectId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "agent-query@example.com",
				passwordHash: "password",
				displayName: "Agent Query User",
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
				name: "Agent Target",
				repoPath: "/workspace/agent-target",
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

	it("returns project overview items, refs, and candidate-only summary", async () => {
		const { scanRunId } = await seedFindingBackedScan();
		await seedCompletedScanReview(scanRunId);

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: { scanRunId, queryKind: "project_overview" },
			generatedAt: GENERATED_AT,
		});

		expect(result).toMatchObject({
			ok: true,
			status: "completed",
			queryKind: "project_overview",
			summary: { candidateOnly: true },
		});
		expect(result.results.some((item) => item.kind === "file_risk")).toBe(true);
		expect(result.refs.sourceRefs).toContain(`scan:${scanRunId}`);
		expect(
			result.results.every((item) =>
				item.sourceRefs.includes(`scan:${scanRunId}`),
			),
		).toBe(true);
		expect(result.refs.findingIds.length).toBeGreaterThan(0);
		expect(result.bundles.landscape).toBeDefined();
	});

	it("does not claim a zero-finding scan is safe", async () => {
		const scanRunId = await seedScanRun();

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: { scanRunId, queryKind: "project_overview" },
			generatedAt: GENERATED_AT,
		});

		const serialized = JSON.stringify(result).toLowerCase();
		expect(result.results).toEqual([
			expect.objectContaining({ kind: "landscape" }),
		]);
		expect(result.degradedReasons).toContain("no stored findings in this scan run");
		expect(serialized).not.toContain("safe");
		expect(serialized).not.toContain("secure");
	});

	it("returns focused risk context by file", async () => {
		const { scanRunId, xssFindingId } = await seedFindingBackedScan();
		await seedFinding({
			scanRunId,
			path: "src/admin.ts",
			ruleId: "typescript.authz.missing-check",
			severity: "medium",
			fingerprint: "fp-authz",
			title: "Missing authorization check",
		});

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "risk_context",
				file: "src/app.ts",
				includeCommunities: false,
				includeLandscape: false,
			},
			generatedAt: GENERATED_AT,
		});

		expect(result.refs.findingIds).toEqual([xssFindingId]);
		expect(result.refs.fileRefs).toEqual(["src/app.ts"]);
		expect(result.results.map((item) => item.kind)).toContain("finding");
	});

	it("finds related findings by shared scanner rule", async () => {
		const { scanRunId, xssFindingId } = await seedFindingBackedScan();
		const secondFindingId = await seedFinding({
			scanRunId,
			path: "src/other.ts",
			ruleId: "typescript.express.xss",
			severity: "medium",
			fingerprint: "fp-xss-2",
			title: "Second reflected XSS",
		});

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "related_findings",
				findingId: xssFindingId,
				ruleId: "typescript.express.xss",
			},
			generatedAt: GENERATED_AT,
		});

		expect(result.refs.findingIds).toContain(secondFindingId);
		const findingItems = result.results.filter((item) => item.kind === "finding");
		expect(findingItems).toEqual([
			expect.objectContaining({
				findingIds: [secondFindingId],
			}),
		]);
		expect(findingItems.some((item) => item.findingIds.includes(xssFindingId))).toBe(
			false,
		);
	});

	it("returns degraded broad context when requested finding is missing", async () => {
		const { scanRunId } = await seedFindingBackedScan();
		const missingFindingId = "00000000-0000-4000-8000-000000000002";

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "risk_context",
				findingId: missingFindingId,
				includeCommunities: false,
				includeLandscape: false,
			},
			generatedAt: GENERATED_AT,
		});

		expect(result.results).toEqual([]);
		expect(result.degradedReasons).toContain(
			`requested finding not found: ${missingFindingId}`,
		);
		expect(result.degradedReasons).toContain("no exact risk context matches found");
	});

	it("returns degraded empty related findings when filters match nothing", async () => {
		const { scanRunId } = await seedFindingBackedScan();

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "related_findings",
				ruleId: "typescript.no-such-rule",
			},
			generatedAt: GENERATED_AT,
		});

		expect(result.results).toEqual([]);
		expect(result.degradedReasons).toContain(
			"no matching related findings found",
		);
	});

	it("returns evidence bundles without raw snippets or artifact bodies", async () => {
		const { scanRunId, xssFindingId, evidenceId, artifactId } =
			await seedFindingBackedScan({
				snippet: "SECRET_SNIPPET_SHOULD_NOT_LEAK",
				artifactMetadata: { rawContent: "SECRET_ARTIFACT_SHOULD_NOT_LEAK" },
			});

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "evidence_bundle",
				findingId: xssFindingId,
				includeMarkdown: true,
			},
			generatedAt: GENERATED_AT,
		});

		expect(result.refs.evidenceRefs).toContain(evidenceId);
		expect(result.refs.artifactRefs).toContain(artifactId);
		expect(result.bundles.markdown).toContain("Static Intelligence Context");
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("SECRET_SNIPPET_SHOULD_NOT_LEAK");
		expect(serialized).not.toContain("SECRET_ARTIFACT_SHOULD_NOT_LEAK");
	});

	it("returns verification commands without executing them", async () => {
		const { scanRunId, xssFindingId } = await seedFindingBackedScan();
		await seedCompletedScanReview(scanRunId);

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "verification_commands",
				findingId: xssFindingId,
			},
			generatedAt: GENERATED_AT,
		});

		expect(result.results).toEqual([
			expect.objectContaining({
				kind: "verification_command",
				sourceRefs: [
					`handoff:${scanRunId}`,
					`finding:${xssFindingId}`,
					"file:src/app.ts",
				],
				metadata: { command: "bun test", ordinal: 1 },
			}),
		]);
	});

	it("wraps the Phase 29 export payload", async () => {
		const { scanRunId } = await seedFindingBackedScan();

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: { scanRunId, queryKind: "export_static_intelligence" },
			generatedAt: GENERATED_AT,
		});

		expect(result.bundles.export?.version).toBe("v1");
		expect(result.bundles.export?.scan.id).toBe(scanRunId);
	});

	it("degrades semantic-only requests when no index/provider is available", async () => {
		const { scanRunId } = await seedFindingBackedScan();

		const result = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "risk_context",
				query: "auth boundary",
				includeSemantic: true,
				includeLandscape: false,
				includeCommunities: false,
			},
			generatedAt: GENERATED_AT,
		});

		expect(result.results).toEqual([]);
		expect(result.degradedReasons).toContain(
			"static intelligence embedding index is empty",
		);
		expect(result.degradedReasons).toContain(
			"query-only risk context has no semantic enrichment available",
		);
	});

	it("rejects invalid input combinations", async () => {
		const { scanRunId } = await seedFindingBackedScan();

		await expect(
			runStaticIntelligenceAgentQuery({
				db: connection.db,
				input: { scanRunId, queryKind: "evidence_bundle" },
				generatedAt: GENERATED_AT,
			}),
		).rejects.toBeInstanceOf(ZodError);

		await expect(
			runStaticIntelligenceAgentQuery({
				db: connection.db,
				input: {
					scanRunId,
					queryKind: "risk_context",
					topK: 99,
					query: "risk",
				},
				generatedAt: GENERATED_AT,
			}),
		).rejects.toBeInstanceOf(ZodError);
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
		const xssFindingId = await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			severity: "high",
			fingerprint: "fp-xss",
			title: "Reflected XSS",
		});
		const [evidence] = await connection.db
			.insert(findingEvidences)
			.values({
				findingId: xssFindingId,
				kind: "source-location",
				title: "Source location",
				artifactId: artifact.id,
				location: { path: "src/app.ts", startLine: 12 },
				snippet: options.snippet ?? "res.send(req.query.name);",
				metadata: {},
				createdAt: NOW,
			})
			.returning();
		return {
			scanRunId,
			xssFindingId,
			evidenceId: evidence.id,
			artifactId: artifact.id,
		};
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

	async function seedCompletedScanReview(scanRunId: string) {
		await connection.db.insert(scanReviews).values({
			scanRunId,
			projectId,
			provider: "openai",
			model: "gpt-4o-mini",
			status: "completed",
			summary: "Review completed.",
			riskOverview: "High risk XSS finding.",
			priorityNotes: ["Fix the XSS first."],
			coverageNotes: [],
			falsePositiveHotspots: [],
			recommendedNextActions: ["Patch and test."],
			findingTriageHints: [],
			confidenceNotes: [],
			inputBundle: {},
			output: buildScanReviewOutput(),
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 1000),
			createdAt: NOW,
			updatedAt: NOW,
		});
	}
});

function buildScanReviewOutput() {
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
			scope: ["Stored scan evidence only."],
			priorityPlan: [],
			implementationTasks: [],
			acceptanceCriteria: ["Injected HTML is escaped."],
			verificationCommands: ["bun test"],
			constraints: ["Do not add a new scanner."],
			nonGoals: ["Do not redesign the app."],
			handoffPrompt: "Fix the reflected XSS based on stored evidence.",
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
