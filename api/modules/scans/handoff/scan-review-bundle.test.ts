import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../../db";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanRuns,
	toolRuns,
	users,
} from "../../../db/schema";
import { buildScanReviewBundle } from "./scan-review-bundle";

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of sqlFiles) {
		connection.sqlite.exec(
			readFileSync(path.resolve(migrationsDir, filename), "utf8"),
		);
	}
}

describe("buildScanReviewBundle filters", () => {
	let connection: DbConnection;
	let scanRunId: string;
	let projectId: string;
	let toolRunId: string;
	const now = new Date("2026-06-27T00:00:00.000Z");

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "bundle@example.com",
				passwordHash: "hash",
				displayName: "Bundle User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: user.id,
				name: "Target",
				repoPath: "/tmp/target",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: now,
				completedAt: now,
				createdByUserId: user.id,
				summary: "completed",
				metadata: {
					profileId: "baseline",
					scope: { intent: "source_baseline" },
					scanPreflight: {
						mode: "enforced",
						status: "ready",
						bindingHash: `sha256:${"a".repeat(64)}`,
						preflightHash: `sha256:${"b".repeat(64)}`,
						limitationCodes: [],
						secret: "must-not-enter-the-bundle",
					},
					executionPlan: {
						planHash: `sha256:${"c".repeat(64)}`,
						profileId: "baseline",
						strictness: "best_effort",
						blockerCodes: [],
						steps: [],
						secret: "must-not-enter-the-bundle",
					},
					toolResults: [{ toolId: "semgrep", status: "completed" }],
					stepResults: [{ kind: "static_tool", status: "completed" }],
				},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = scanRun.id;
		const [toolRun] = await connection.db.insert(toolRuns).values({
			scanRunId,
			toolName: "semgrep",
			toolVersion: "1.0.0",
			command: "semgrep",
			status: "completed",
			exitCode: 0,
			startedAt: now,
			completedAt: now,
			createdAt: now,
			updatedAt: now,
		}).returning();
		toolRunId = toolRun.id;
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	async function addFinding(input: {
		title: string;
		severity: "low" | "medium" | "high" | "critical";
		fingerprint: string;
		targetScanRunId?: string;
		metadata?: Record<string, unknown>;
		withEvidence?: boolean;
		description?: string;
		evidenceSnippet?: string;
		evidenceMetadata?: Record<string, unknown>;
	}) {
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId: input.targetScanRunId ?? scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: input.fingerprint,
				title: input.title,
				description: input.description ?? input.title,
				severity: input.severity,
				confidence: "static",
				status: "open",
				primaryLocation: { path: `${input.fingerprint}.ts`, startLine: 1 },
				fingerprint: input.fingerprint,
				metadata: input.metadata ?? {},
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		if (input.withEvidence) {
			await connection.db.insert(findingEvidences).values({
				findingId: finding.id,
				kind: "source-location",
				title: "source",
				artifactId: null,
				location: { path: `${input.fingerprint}.ts`, startLine: 1 },
				snippet: input.evidenceSnippet ?? "code",
				metadata: input.evidenceMetadata ?? {},
				createdAt: now,
			});
		}
		return finding;
	}

	async function addScanRun(input: {
		id?: string;
		createdAt: Date;
		profile?: string;
	}) {
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: input.profile ?? "baseline",
				status: "completed",
				startedAt: input.createdAt,
				completedAt: input.createdAt,
				createdAt: input.createdAt,
				updatedAt: input.createdAt,
			})
			.returning();
		await connection.db.insert(toolRuns).values({
			scanRunId: scanRun.id,
			toolName: "semgrep",
			toolVersion: "1.0.0",
			command: "semgrep",
			status: "completed",
			exitCode: 0,
			startedAt: input.createdAt,
			completedAt: input.createdAt,
			createdAt: input.createdAt,
			updatedAt: input.createdAt,
		});
		return scanRun;
	}

	it("includes only high and critical findings for high_or_critical", async () => {
		await addFinding({
			title: "Low",
			severity: "low",
			fingerprint: "low",
			withEvidence: true,
		});
		await addFinding({
			title: "High",
			severity: "high",
			fingerprint: "high",
			withEvidence: true,
		});
		await addFinding({
			title: "Critical",
			severity: "critical",
			fingerprint: "critical",
			withEvidence: true,
		});

		const bundle = await buildScanReviewBundle(connection.db, scanRunId, {
			findingFilter: "high_or_critical",
		});

		expect(bundle.findings.map((finding) => finding.title)).toEqual([
			"Critical",
			"High",
		]);
		expect(bundle.limits.findingFilter).toBe("high_or_critical");
	});

	it("paginates findings with a deterministic offset without omissions", async () => {
		const critical = await addFinding({
			title: "Critical",
			severity: "critical",
			fingerprint: "critical",
		});
		const high = await addFinding({
			title: "High",
			severity: "high",
			fingerprint: "high",
		});
		const medium = await addFinding({
			title: "Medium",
			severity: "medium",
			fingerprint: "medium",
		});

		const first = await buildScanReviewBundle(connection.db, scanRunId, {
			findingFilter: "all",
			maxFindings: 2,
			findingOffset: 0,
		});
		const second = await buildScanReviewBundle(connection.db, scanRunId, {
			findingFilter: "all",
			maxFindings: 2,
			findingOffset: 2,
		});

		expect(first.findings.map((finding) => finding.id)).toEqual([
			critical.id,
			high.id,
		]);
		expect(second.findings.map((finding) => finding.id)).toEqual([medium.id]);
		expect(
			new Set(
				[...first.findings, ...second.findings].map((finding) => finding.id),
			),
		).toEqual(new Set([critical.id, high.id, medium.id]));
		expect(first.limits).toMatchObject({
			filteredFindings: 3,
			includedFindings: 2,
			findingOffset: 0,
		});
		expect(second.limits).toMatchObject({
			filteredFindings: 3,
			includedFindings: 1,
			findingOffset: 2,
		});
	});

	it("includes findings with missing evidence", async () => {
		await addFinding({
			title: "Has evidence",
			severity: "high",
			fingerprint: "with-evidence",
			withEvidence: true,
		});
		await addFinding({
			title: "Missing evidence",
			severity: "medium",
			fingerprint: "missing-evidence",
		});

		const bundle = await buildScanReviewBundle(connection.db, scanRunId, {
			findingFilter: "weak_or_missing_evidence",
		});

		expect(bundle.findings.map((finding) => finding.title)).toEqual([
			"Has evidence",
			"Missing evidence",
		]);
	});

	it("compacts duplicated metadata and long finding text for LLM input", async () => {
		await addFinding({
			title: "Long finding",
			severity: "high",
			fingerprint: "long-finding",
			withEvidence: true,
			description: "d".repeat(200),
			evidenceSnippet: "s".repeat(200),
		});

		const bundle = await buildScanReviewBundle(connection.db, scanRunId, {
			maxDescriptionChars: 20,
			maxSnippetChars: 15,
		});

		expect(bundle.scanRun.metadata).toEqual({
			profileId: "baseline",
			scope: { intent: "source_baseline" },
			scanPreflight: {
				mode: "enforced",
				status: "ready",
				bindingHash: `sha256:${"a".repeat(64)}`,
				preflightHash: `sha256:${"b".repeat(64)}`,
				limitationCodes: [],
			},
			executionPlan: {
				planHash: `sha256:${"c".repeat(64)}`,
				profileId: "baseline",
				strictness: "best_effort",
				blockerCodes: [],
				steps: [],
			},
		});
		expect(bundle.summary.tools[0]).not.toHaveProperty("metadata");
		expect(bundle.findings[0]?.description).toBe(
			`${"d".repeat(20)}\n[truncated]`,
		);
		expect(bundle.findings[0]?.evidence[0]?.snippet).toBe(
			`${"s".repeat(15)}\n[truncated]`,
		);
	});

	it("includes allowlisted authorization observations without secret metadata", async () => {
		await addFinding({
			title: "Cross-owner access",
			severity: "high",
			fingerprint: "authorization-matrix",
			withEvidence: true,
			metadata: {
				evidenceStrength: "runtime_observed",
				actorRole: "user-a",
				objectId: "object-b",
				operationId: "read-object",
				expected: "denied",
				observed: "allowed",
				statusCode: 200,
				activeEvidenceId: "active-evidence-1",
				authorization: "must-not-enter-the-bundle",
			},
			evidenceMetadata: {
				activeAssessmentEvidenceId: "active-evidence-1",
				statusCode: 200,
				responseBody: "must-not-enter-the-bundle",
			},
		});

		const bundle = await buildScanReviewBundle(connection.db, scanRunId);
		expect(bundle.findings[0]?.metadata).toEqual({
			evidenceStrength: "runtime_observed",
			actorRole: "user-a",
			objectId: "object-b",
			operationId: "read-object",
			expected: "denied",
			observed: "allowed",
			statusCode: 200,
			activeEvidenceId: "active-evidence-1",
		});
		expect(bundle.findings[0]?.evidence[0]?.metadata).toEqual({
			activeAssessmentEvidenceId: "active-evidence-1",
			statusCode: 200,
		});
		expect(JSON.stringify(bundle)).not.toContain("must-not-enter-the-bundle");
	});

	it("never forwards arbitrary artifact metadata to the LLM bundle", async () => {
		await connection.db.insert(scanArtifacts).values({
			scanRunId,
			toolRunId,
			kind: "raw_result",
			format: "json",
			path: "/tmp/result.json",
			sha256: "a".repeat(64),
			sizeBytes: 10,
			metadata: {
				authorization: "artifact-secret-canary",
				arbitraryPayload: { nested: true },
			},
			createdAt: now,
		});
		const bundle = await buildScanReviewBundle(connection.db, scanRunId);
		expect(bundle.artifacts).toHaveLength(1);
		expect(bundle.artifacts[0]).not.toHaveProperty("metadata");
		expect(JSON.stringify(bundle)).not.toContain("artifact-secret-canary");
	});

	it("derives new_or_regressed from the previous same-profile scan", async () => {
		const baseline = await addScanRun({
			createdAt: new Date("2026-06-26T23:00:00.000Z"),
		});
		await addFinding({
			title: "Unchanged",
			severity: "high",
			fingerprint: "unchanged",
			targetScanRunId: baseline.id,
			withEvidence: true,
		});
		await addFinding({
			title: "Regressed",
			severity: "low",
			fingerprint: "regressed",
			targetScanRunId: baseline.id,
			withEvidence: true,
		});
		await addFinding({
			title: "New",
			severity: "high",
			fingerprint: "new",
			withEvidence: true,
		});
		await addFinding({
			title: "Unchanged",
			severity: "high",
			fingerprint: "unchanged",
			withEvidence: true,
		});
		await addFinding({
			title: "Regressed",
			severity: "critical",
			fingerprint: "regressed",
			withEvidence: true,
		});

		const bundle = await buildScanReviewBundle(connection.db, scanRunId, {
			findingFilter: "new_or_regressed",
		});

		expect(bundle.findings.map((finding) => finding.title).sort()).toEqual([
			"New",
			"Regressed",
		]);
	});

	it("rejects new_or_regressed when comparison metadata is unavailable", async () => {
		await addFinding({
			title: "Current",
			severity: "high",
			fingerprint: "current",
			withEvidence: true,
		});

		await expect(
			buildScanReviewBundle(connection.db, scanRunId, {
				findingFilter: "new_or_regressed",
			}),
		).rejects.toThrow("previous same-profile scan or comparison metadata");
	});
});
