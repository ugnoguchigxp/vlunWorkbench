import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPORT_SECTION_DEFINITIONS } from "../../../shared/report-sections";
import { createDbConnection, type DbConnection } from "../../db";
import {
	diagnosticReports,
	findingDecisions,
	findingEvidences,
	findingReviews,
	findings,
	projects,
	scanArtifacts,
	scanReviews,
	scanRuns,
	securityCheckResults,
	toolRuns,
	users,
} from "../../db/schema";
import { buildMarkdownReport } from "./report-builder";

function buildImprovementRequest(findingId: string) {
	return {
		title: "反射型 XSS 改善依頼",
		objective:
			"保存済みの scan evidence に基づき、ユーザー入力の出力時エスケープ不足を修正する。",
		scope: ["対象は scan bundle に含まれる finding と evidence に限定します。"],
		priorityPlan: [
			{
				priority: "high",
				rationale: "高 severity でユーザー入力が出力に到達しているため優先します。",
				findingIds: [findingId],
			},
		],
		implementationTasks: [
			{
				title: "出力エスケープを追加する",
				body: "該当箇所でユーザー入力を HTML として解釈されない形にエスケープしてください。",
				findingIds: [findingId],
				evidenceRefs: ["src/app.js:12"],
			},
		],
		acceptanceCriteria: [
			"ユーザー入力が HTML として実行されないことを確認できる。",
		],
		verificationCommands: ["bun test"],
		constraints: ["保存済み evidence 以外を見た前提で書かない。"],
		nonGoals: ["新しい scanner 実装は含めない。"],
		handoffPrompt:
			"保存済み scan context に基づき、反射型 XSS finding を修正してください。対象範囲は bundle 内の finding と evidence に限定し、出力エスケープ追加、回帰テスト、bun test による検証を行ってください。",
	};
}

function sectionBody(markdown: string, heading: string): string {
	const start = markdown.indexOf(heading);
	if (start === -1) return "";
	const next = markdown.indexOf("\n## ", start + heading.length);
	return markdown.slice(start, next === -1 ? undefined : next);
}

describe("Report Builder", () => {
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let findingId1: string;
	let findingId2: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");

		// Apply migrations
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		const sqlFiles = readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b));

		for (const filename of sqlFiles) {
			const sqlPath = path.resolve(migrationsDir, filename);
			const sql = readFileSync(sqlPath, "utf8");
			connection.sqlite.exec(sql);
		}

		// Seed user
		const now = new Date("2026-06-23T12:00:00.000Z");
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "reporter@example.com",
				passwordHash: "password",
				displayName: "Reporter User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;

		// Seed project
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "Target Project",
				repoPath: "/path/to/target",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;

		// Seed scan run
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: now,
				completedAt: new Date(now.getTime() + 5000),
				createdByUserId: userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = scanRun.id;

		// Seed tool run
		await connection.db.insert(toolRuns).values({
			scanRunId,
			toolName: "Semgrep",
			toolVersion: "1.0.0",
			command: "semgrep scan",
			status: "completed",
			exitCode: 0,
			startedAt: now,
			completedAt: new Date(now.getTime() + 4000),
			createdAt: now,
			updatedAt: now,
		});

		// Seed artifact
		const [artifact] = await connection.db.insert(scanArtifacts).values({
			scanRunId,
			kind: "raw_result",
			format: "json",
			path: "raw/results.json",
			sha256: "fake-sha",
			sizeBytes: 1234,
			createdAt: now,
		}).returning();

		// Seed findings
		const [f1] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "Semgrep",
				ruleId: "rules.xss",
				title: "Reflected XSS",
				description: "User input is printed without escaping",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/app.js", startLine: 12 },
				fingerprint: "fp1",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId1 = f1.id;

		const [f2] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "Semgrep",
				ruleId: "rules.sqli",
				title: "SQL Injection",
				description: "Raw SQL query query",
				severity: "critical",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/db.js", startLine: 45 },
				fingerprint: "fp2",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId2 = f2.id;

		// Seed evidence
		await connection.db.insert(findingEvidences).values({
			findingId: findingId1,
			kind: "source-location",
			title: "xss vulnerability source location",
			artifactId: artifact.id,
			location: { path: "src/app.js", startLine: 12 },
			snippet: "res.send(req.query.name);",
			createdAt: now,
		});

		// Seed review
		await connection.db.insert(findingReviews).values({
			findingId: findingId1,
			provider: "openai",
			model: "gpt-4",
			status: "completed",
			summary: "LLM confirmed XSS vulnerability.",
			likelyImpact: "Attacker can execute arbitrary JS.",
			falsePositiveAssessment: { level: "low", reasoning: "Code prints name directly." },
			evidenceStrength: { level: "strong", reasoning: "Explicit source/sink matches." },
			remediationDirection: "Sanitize or use templates.",
			reviewerNotes: ["Checked index.js too."],
			confidenceAdjustment: "unchanged",
			createdAt: now,
			updatedAt: now,
		});

		// Seed decision (f1: needs_fix, f2: undecided)
		await connection.db.insert(findingDecisions).values({
			findingId: findingId1,
			decision: "needs_fix",
			reason: "confirmed_by_review",
			comment: "Will patch immediately.",
			createdAt: now,
			updatedAt: now,
		});
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("generates a deterministic report markdown", async () => {
		const options = {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
			title: "Custom Security Report",
		};

		const report1 = await buildMarkdownReport(connection.db, scanRunId, options);
		const report2 = await buildMarkdownReport(connection.db, scanRunId, options);

		expect(report1).toBe(report2); // Deterministic

		// Content checks
		expect(report1).toContain("# Custom Security Report");
		expect(report1).toContain("## スキャン概要");
		expect(report1).toContain("## 全体考察");
		expect(report1).toContain("検出件数は 2 件");
		expect(report1).toContain("## Decision-grade Executive Summary");
		expect(report1).toContain("## Risk Ranking");
		expect(report1).toContain("## Evidence Quality Summary");
		expect(report1).toContain("## LLM Implementation Handoff");
		expect(report1).toContain("## Remediation Plan");
		expect(report1).toContain("## Verification Status");
		expect(report1).toContain("## Scan Comparison Delta");
		expect(report1).toContain("## Zero-Finding Coverage Explanation");
		expect(report1).toContain("## Appendix");
		expect(report1).toContain("## ツール実行サマリ");
		expect(report1).toContain("## 実装改善ルーティングサマリ");
		expect(report1).toContain("## Severity サマリ");
		expect(report1).toContain("## 実装改善候補・既知リスク Finding");
		expect(report1).toContain("### Finding " + findingId1);
		expect(report1).toContain("- **Severity:** 高 (high)");
		expect(report1).toContain("#### 考察");
		expect(report1).toContain("- **実装改善ルーティング:** 実装改善候補");
		expect(report1).toContain("- **想定影響:** Attacker can execute arbitrary JS.");
		expect(report1).toContain("source-location 1件");
		expect(report1).toContain("LLM confirmed XSS vulnerability.");
		expect(report1).toContain("## 任意注釈なし Finding");
		expect(report1).toContain("### Finding " + findingId2);
		expect(report1).toContain("- **Severity:** 緊急 (critical)");
		expect(report1).toContain("LLMレビューは未完了");
		expect(report1).toContain("再現・動的検証・DAST証跡はまだ記録されていません。");

		// Phase 12 Additions checks
		expect(report1).toContain("## Sandbox Reproduction サマリ");
		expect(report1).toContain("## Dynamic Verification サマリ");
		expect(report1).toContain("## DAST サマリ");
		expect(report1).toContain("## 検証メタデータ");
		expect(report1).toContain("#### Sandbox Reproduction");
		expect(report1).toContain("#### Dynamic Verification");
		expect(report1).toContain("#### DAST証跡");
	});

	it("keeps preview section headings aligned with generated markdown", async () => {
		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
			title: "Section Contract Report",
		});

		for (const section of REPORT_SECTION_DEFINITIONS) {
			const hasPrimary = report.includes(section.markdownHeading);
			const hasAlternate = section.alternateMarkdownHeading
				? report.includes(section.alternateMarkdownHeading)
				: false;
			expect(hasPrimary || hasAlternate, section.id).toBe(true);
		}
	});

	it("uses the latest completed review as report content", async () => {
		const now = new Date("2026-06-23T12:00:00.000Z");
		await connection.db.insert(findingReviews).values({
			findingId: findingId1,
			provider: "openai",
			model: "gpt-4.1",
			status: "failed",
			summary: null,
			likelyImpact: null,
			falsePositiveAssessment: null,
			evidenceStrength: null,
			remediationDirection: null,
			reviewerNotes: null,
			confidenceAdjustment: "unknown",
			errorMessage: "Provider unavailable",
			createdAt: new Date(now.getTime() + 1000),
			updatedAt: new Date(now.getTime() + 1000),
		});

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
			title: "Review Selection Report",
		});

		expect(report).toContain("LLM confirmed XSS vulnerability.");
		expect(report).toContain("Review ID:");
		expect(report).toContain("Status: failed");
		expect(report).not.toContain("- **エラー:** Provider unavailable");
	});

	it("uses a Japanese default title when title is omitted", async () => {
		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});

		expect(report).toContain("# セキュリティレポート");
	});

	it("includes the latest scan improvement request when scan review output has one", async () => {
		const now = new Date("2026-06-23T12:00:00.000Z");
		await connection.db.insert(scanReviews).values({
			scanRunId,
			projectId,
			provider: "codex",
			model: "gpt-5",
			status: "completed",
			summary: "改善依頼書を生成しました。",
			riskOverview: "反射型 XSS の修正が必要です。",
			priorityNotes: ["反射型 XSS を優先してください。"],
			coverageNotes: ["保存済み scan evidence に限定されています。"],
			falsePositiveHotspots: [],
			recommendedNextActions: ["出力エスケープを追加してください。"],
			findingTriageHints: [
				{
					findingId: findingId1,
					note: "優先して修正してください。",
					priority: "high",
				},
			],
			confidenceNotes: ["source-location evidence に基づいています。"],
			output: {
				improvementRequest: buildImprovementRequest(findingId1),
			},
			startedAt: now,
			completedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
			title: "Improvement Request Report",
		});

		expect(report).toContain("## LLM Implementation Handoff");
		expect(report).toContain("### 改善依頼書");
		expect(report).toContain("- **タイトル:** 反射型 XSS 改善依頼");
		expect(report).toContain("### 実装タスク");
		expect(report).toContain("出力エスケープを追加する");
		expect(report).toContain("### Handoff Prompt");
		expect(report).toContain("保存済み scan context に基づき");
	});

	it("states no findings as a scan-scoped conclusion", async () => {
		await connection.db
			.delete(findingDecisions)
			.where(eq(findingDecisions.findingId, findingId1));
		await connection.db
			.delete(findingReviews)
			.where(eq(findingReviews.findingId, findingId1));
		await connection.db
			.delete(findingEvidences)
			.where(eq(findingEvidences.findingId, findingId1));
		await connection.db.delete(findings);

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});

		expect(report).toContain(
			"**結論:** 今回のスキャン範囲では、対応が必要な指摘事項は発見されませんでした。",
		);
		expect(report).toContain(
			"完全な安全性を証明するものではありません。",
		);
		expect(report).toContain("## Zero-Finding Coverage Explanation");
		expect(report).toContain("finding 0 is not a proof of safety");
		expect(report).toContain(
			"unexecuted checks and missing diagnostics remain residual risk",
		);
		expect(report).toContain("Diagnostic report status:** missing");
		expect(report).toContain("must not be read as a safety attestation");
	});

	it("reports stored preflight checks and does not treat blocked zero findings as safe", async () => {
		await connection.db.delete(findings);
		const digest = `sha256:${"a".repeat(64)}`;
		await connection.db
			.update(scanRuns)
			.set({
				metadata: {
					profileOutcome: "failed",
					terminationReason: "preflight_failed",
					scanPreflight: {
						schemaVersion: 1,
						projectId,
						profileId: "baseline",
						sourceRevision: null,
						mode: "enforced",
						status: "blocked",
						createdAt: "2026-08-16T00:00:00.000Z",
						checks: [
							{
								id: "osv:scanner-data",
								stepId: "osv",
								kind: "scanner_data",
								required: true,
								status: "blocked",
								reasonCode: "scanner_data_missing",
								action: "prepare_scanner_database",
								scannerId: "osv",
								observedVersion: null,
								expectedVersion: "2.4.0",
								expectedDigest: digest,
								observedDigest: null,
								dataState: "missing",
								dataGeneratedAt: null,
								evidenceRefs: [],
							},
						],
						summary: {
							ready: 0,
							blockedRequired: 1,
							blockedOptional: 0,
							notApplicable: 0,
						},
						limitationCodes: ["scanner_data_missing"],
						binding: {
							resolvedProfileHash: digest,
							executionHash: digest,
							scannerManifestHash: digest,
							scannerVersionsHash: digest,
							dockerImagesHash: null,
							targetPlanHash: null,
							sourceRevisionHash: null,
						},
						bindingHash: digest,
						preflightHash: digest,
					},
				},
			})
			.where(eq(scanRuns.id, scanRunId));

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});
		expect(report).toContain("Scan preflight");
		expect(report).toContain("scanner_data_missing");
		expect(report).toContain("prepare_scanner_database");
		expect(report).toContain(
			"finding 0件を安全性判断には使用できません",
		);
	});

	it("does not treat a missing expected DAST run as a clean zero-finding result", async () => {
		await connection.db
			.delete(findingDecisions)
			.where(eq(findingDecisions.findingId, findingId1));
		await connection.db
			.delete(findingReviews)
			.where(eq(findingReviews.findingId, findingId1));
		await connection.db
			.delete(findingEvidences)
			.where(eq(findingEvidences.findingId, findingId1));
		await connection.db.delete(findings);
		await connection.db
			.update(scanRuns)
			.set({
				profile: "web-app-baseline",
				metadata: {
					profileOutcome: "partial",
					stepResults: [],
				},
			})
			.where(eq(scanRuns.id, scanRunId));

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});

		expect(report).toContain(
			"DASTに未走査・通信失敗・認証失敗またはcoverage不明の領域があるため",
		);
		expect(report).not.toContain(
			"**結論:** 今回のスキャン範囲では、対応が必要な指摘事項は発見されませんでした。",
		);
	});

	it("reports diff provenance, whole-file semantics, and coverage gaps", async () => {
		await connection.db.delete(findings);
		await connection.db
			.update(scanRuns)
			.set({
				metadata: {
					profileOutcome: "partial",
					target: {
						kind: "working_tree",
						baseSha: "a".repeat(40),
						headSha: null,
						mergeBaseSha: null,
						targetDigest: "b".repeat(64),
					},
					diffCoverage: {
						changed: 3,
						scannable: 1,
						deleted: 1,
						excluded: 1,
						unsupported: 0,
						tooLarge: 0,
					},
					diffToolApplicability: [
						{
							toolId: "osv",
							applicability: "not_applicable",
							reasonCode: "no_dependency_manifest_changed",
							coverageEffect: "covered",
						},
					],
				},
			})
			.where(eq(scanRuns.id, scanRunId));

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});

		expect(report).toContain("## Diff Target and Coverage");
		expect(report).toContain("**Target kind:** working_tree");
		expect(report).toContain("whole-file");
		expect(report).toContain(
			"finding が変更行で新規に導入されたことを意味しません",
		);
		expect(report).toContain("no_dependency_manifest_changed");
		expect(report).toContain(
			"**Diff coverage gaps:** excluded=1, unsupported=0, too_large=0",
		);
		expect(report).toContain(
			"**Diff scope:** kind=working_tree, changed=3, scannable=1",
		);
	});

	it("does not treat an empty diff as a security conclusion", async () => {
		await connection.db.delete(findings);
		await connection.db
			.update(scanRuns)
			.set({
				metadata: {
					target: {
						kind: "range",
						baseSha: "a".repeat(40),
						headSha: "c".repeat(40),
						mergeBaseSha: "a".repeat(40),
						targetDigest: "b".repeat(64),
					},
					diffCoverage: {
						changed: 0,
						scannable: 0,
						deleted: 0,
						excluded: 0,
						unsupported: 0,
						tooLarge: 0,
					},
				},
			})
			.where(eq(scanRuns.id, scanRunId));

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});

		expect(report).toContain("差分対象に変更パスがなく");
		expect(report).toContain("脆弱性がないことを示す結果ではありません");
	});

	it("does not treat zero findings as meaningful when a diff scanner failed", async () => {
		await connection.db.delete(findings);
		await connection.db
			.update(scanRuns)
			.set({
				metadata: {
					target: {
						kind: "working_tree",
						baseSha: "a".repeat(40),
						headSha: null,
						mergeBaseSha: null,
						targetDigest: "b".repeat(64),
					},
					diffCoverage: {
						changed: 1,
						scannable: 1,
						deleted: 0,
						excluded: 0,
						unsupported: 0,
						tooLarge: 0,
					},
					diffToolApplicability: [
						{
							toolId: "semgrep",
							applicability: "applicable",
							reasonCode: null,
							coverageEffect: "covered",
						},
					],
					stepResults: [
						{
							kind: "static_tool",
							toolId: "semgrep",
							status: "failed",
							coverageEffect: "gap",
						},
					],
				},
			})
			.where(eq(scanRuns.id, scanRunId));

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});

		expect(report).toContain(
			"差分対象のscanner実行が完了していないため、finding 0件を安全性の判断には使用できません",
		);
		expect(report).toContain("| semgrep | applicable | failed | - | gap |");
	});

	it("includes diagnostic status in zero-finding reports when available", async () => {
		const now = new Date("2026-06-23T12:00:00.000Z");
		await connection.db
			.delete(findingDecisions)
			.where(eq(findingDecisions.findingId, findingId1));
		await connection.db
			.delete(findingReviews)
			.where(eq(findingReviews.findingId, findingId1));
		await connection.db
			.delete(findingEvidences)
			.where(eq(findingEvidences.findingId, findingId1));
		await connection.db.delete(findings);
		await connection.db.insert(diagnosticReports).values({
			projectId,
			scanRunId,
			reportKind: "zero-finding",
			status: "completed",
			summary: "Coverage reviewed.",
			checkedCategoriesJson: [],
			coverageGapsJson: [],
			residualRisksJson: [],
			recommendedNextActionsJson: [],
			createdAt: now,
			updatedAt: now,
		});

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});

		expect(report).toContain(
			"**Diagnostic report status:** zero-finding:completed",
		);
		expect(report).not.toContain("diagnostic report data is missing");
	});

	it("does not count passing security checks as non-passing in zero-finding coverage", async () => {
		const now = new Date("2026-06-23T12:00:00.000Z");
		await connection.db
			.delete(findingDecisions)
			.where(eq(findingDecisions.findingId, findingId1));
		await connection.db
			.delete(findingReviews)
			.where(eq(findingReviews.findingId, findingId1));
		await connection.db
			.delete(findingEvidences)
			.where(eq(findingEvidences.findingId, findingId1));
		await connection.db.delete(findings);
		await connection.db.insert(securityCheckResults).values({
			projectId,
			scanRunId,
			checkId: "scan.zero_finding_has_coverage_context",
			status: "pass",
			outcome: "coverage reviewed",
			title: "Zero finding coverage context",
			summary: "Coverage context is available.",
			evidenceRefsJson: [],
			createdAt: now,
			updatedAt: now,
		});

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		});

		expect(report).toContain("**Security checks:** 1 result(s); 0 non-passing or incomplete.");
	});

	it("respects exclusion options", async () => {
		const options = {
			includeFalsePositives: false,
			includeDeferred: false,
			includeUndecided: false,
			title: "Filtered Report",
		};

		const report = await buildMarkdownReport(connection.db, scanRunId, options);

		expect(report).toContain("## 実装改善候補・既知リスク Finding");
		expect(report).toContain("### Finding " + findingId1);

		expect(report).toContain("## 任意注釈なし Finding");
		expect(report).toContain(
			"レポート設定により、このセクションは除外されています。",
		);
		expect(report).not.toContain("### Finding " + findingId2);
		expect(sectionBody(report, "## Risk Ranking")).not.toContain(findingId2);
		expect(sectionBody(report, "## Evidence Quality Summary")).not.toContain(
			findingId2,
		);
		expect(sectionBody(report, "## Remediation Plan")).not.toContain(
			findingId2,
		);
	});
});
