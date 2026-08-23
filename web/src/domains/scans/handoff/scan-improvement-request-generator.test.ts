import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
	Finding,
	ScanImprovementRequest,
	ScanReview,
	ScanRun,
} from "../../../api";
import { ScanImprovementRequestGenerator } from "./scan-improvement-request-generator";

const findingId = "11111111-1111-4111-8111-111111111111";
const now = "2026-08-21T00:00:00.000Z";

const finding: Finding = {
	id: findingId,
	scanRunId: "scan-1",
	projectId: "project-1",
	sourceTool: "osv",
	ruleId: "GHSA-test",
	title: "依存関係の脆弱性",
	description: "### 概要\n修正が必要です。<script>alert(1)</script>",
	severity: "high",
	confidence: "static",
	status: "open",
	primaryLocation: { path: "package-lock.json", startLine: 10 },
	fingerprint: "fixture",
	metadata: {},
	createdAt: now,
	updatedAt: now,
};

const scanRun = {
	id: "scan-1",
	projectId: "project-1",
	status: "completed",
	createdAt: now,
	updatedAt: now,
} as ScanRun;

const request: ScanImprovementRequest = {
	title: "セキュリティ改修依頼",
	objective: "保存済み証跡に基づいて検出結果を修正する。",
	scope: ["全 finding を対象にする。"],
	priorityPlan: [
		{
			priority: "high",
			rationale: "重大度が高いため優先する。",
			findingIds: [findingId],
		},
	],
	implementationTasks: [
		{
			title: "依存関係を更新する",
			body: "修正版へ更新して回帰テストを実行する。",
			findingIds: [findingId],
			evidenceRefs: [],
		},
	],
	acceptanceCriteria: ["脆弱なバージョンが解消されている。"],
	verificationCommands: ["bun test"],
	constraints: ["保存済み context だけを根拠にする。"],
	nonGoals: ["無関係な機能変更は行わない。"],
	handoffPrompt: "保存済み証跡に基づいて依存関係を修正してください。",
};

function review(includedFindings: number, totalFindings: number): ScanReview {
	return {
		id: "review-1",
		scanRunId: "scan-1",
		projectId: "project-1",
		provider: "codex",
		model: "gpt-5",
		status: "completed",
		summary: "指示書を生成しました。",
		riskOverview: "修正が必要です。",
		priorityNotes: [],
		coverageNotes: [],
		falsePositiveHotspots: [],
		recommendedNextActions: [],
		findingTriageHints: [],
		confidenceNotes: [],
		inputBundle: {
			generationKind: "improvement_request",
			limits: {
				findingFilter: "all",
				includedFindings,
				totalFindings,
			},
		},
		output: { improvementRequest: request },
		errorMessage: null,
		createdAt: now,
		startedAt: now,
		completedAt: now,
		updatedAt: now,
	};
}

const render = (reviews: ScanReview[]) =>
	renderToStaticMarkup(
		createElement(ScanImprovementRequestGenerator, {
			scanRun,
			findings: [finding],
			reviews,
			generating: false,
			onGenerate: () => undefined,
		}),
	);

describe("ScanImprovementRequestGenerator", () => {
	it("offers one aggregate generation action when no request exists", () => {
		const markup = render([]);
		expect(markup).toContain("LLMへの改修依頼指示書");
		expect(markup).toContain("指示書を生成");
		expect(markup).not.toContain("LLM レビューを実行");
	});

	it("renders and exports a fully covered instruction request", () => {
		const markup = render([review(1, 1)]);
		expect(markup).toContain("指示書を再生成");
		expect(markup).toContain("指示書をコピー");
		expect(markup).toContain('aria-label="改修依頼指示書"');
		expect(markup).toContain("<h1>セキュリティ改修依頼</h1>");
		expect(markup).toContain("<h2>実装タスク</h2>");
		expect(markup).toContain("<pre><code class=\"language-bash\">bun test");
		expect(markup).not.toContain("# セキュリティ改修依頼");
		expect(markup).not.toContain("依頼指示書をプレビュー");
		expect(markup).not.toContain("引き継ぎ品質");
		expect(markup).not.toContain("対象 finding 一覧");
		expect(markup).not.toContain(findingId);
		expect(markup).not.toContain("codex / gpt-5");
		expect(markup).not.toContain("<script");
	});

	it("warns when a legacy request covered only the first 50 findings", () => {
		const markup = render([review(50, 51)]);
		expect(markup).toContain("50 / 51 件を対象");
		expect(markup).toContain("全件版を生成してください");
	});

	it("does not show an automatic diagnostic review as instruction generation", () => {
		const diagnosticReview = {
			...review(1, 1),
			status: "running" as const,
			inputBundle: {},
		};
		const markup = render([diagnosticReview]);

		expect(markup).toContain("指示書を生成");
		expect(markup).not.toContain("指示書を生成中");
		expect(markup).not.toContain("改修タスクと受け入れ条件を作成しています");
	});
});
