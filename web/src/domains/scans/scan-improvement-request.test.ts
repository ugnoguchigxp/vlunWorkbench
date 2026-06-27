import { describe, expect, it } from "vitest";
import type { ScanImprovementRequest, ScanReview } from "../../api";
import {
	buildScanImprovementRequestMarkdown,
	buildScanImprovementRequestView,
	classifyScanReviewFailure,
	getScanImprovementRequest,
	hasScanImprovementRequest,
} from "./scan-improvement-request";

const now = "2026-06-27T00:00:00.000Z";
const findingId = "11111111-1111-4111-8111-111111111111";

function review(
	output: Record<string, unknown> | null,
	overrides: Partial<ScanReview> = {},
): ScanReview {
	return {
		id: "review-1",
		scanRunId: "scan-1",
		projectId: "project-1",
		provider: "codex",
		model: "gpt-5",
		status: "completed",
		summary: "summary",
		riskOverview: "risk",
		priorityNotes: [],
		coverageNotes: [],
		falsePositiveHotspots: [],
		recommendedNextActions: [],
		findingTriageHints: [],
		confidenceNotes: [],
		output: output ?? undefined,
		errorMessage: null,
		createdAt: now,
		startedAt: now,
		completedAt: now,
		updatedAt: now,
		...overrides,
	};
}

function request(
	overrides: Partial<ScanImprovementRequest> = {},
): ScanImprovementRequest {
	return {
		title: "XSS 修正依頼",
		objective: "保存済み scan evidence に基づき XSS を修正する。",
		scope: ["bundle に含まれる XSS finding と evidence に限定する。"],
		priorityPlan: [
			{
				priority: "high",
				rationale: "高 severity のため優先する。",
				findingIds: [findingId],
			},
		],
		implementationTasks: [
			{
				title: "出力エスケープを追加する",
				body: "該当出力経路で HTML エスケープを行う。",
				findingIds: [findingId],
				evidenceRefs: ["src/app.ts:10"],
			},
		],
		acceptanceCriteria: ["入力値が HTML として実行されない。"],
		verificationCommands: ["bun test"],
		constraints: ["保存済み scan bundle と evidence の範囲だけを根拠にする。"],
		nonGoals: ["新しい scanner は追加しない。"],
		handoffPrompt:
			"保存済み scan bundle に基づき XSS を修正してください。検証は bun test です。",
		...overrides,
	};
}

describe("buildScanImprovementRequestView", () => {
	it("no scan review returns missing", () => {
		const view = buildScanImprovementRequestView([]);
		expect(view.available).toBe(false);
		expect(view.readiness).toBe("missing");
	});

	it("full improvementRequest returns ready", () => {
		const view = buildScanImprovementRequestView([
			review({ improvementRequest: request() }),
		]);
		expect(view.available).toBe(true);
		expect(view.readiness).toBe("ready");
		expect(view.qualityChecks.every((item) => item.status === "ready")).toBe(
			true,
		);
	});

	it("uses the latest valid improvementRequest", () => {
		const view = buildScanImprovementRequestView([
			review(
				{ improvementRequest: request({ title: "古い依頼" }) },
				{
					id: "review-old",
					createdAt: "2026-06-27T00:00:00.000Z",
					completedAt: "2026-06-27T00:00:00.000Z",
				},
			),
			review(
				{ improvementRequest: request({ title: "新しい依頼" }) },
				{
					id: "review-new",
					createdAt: "2026-06-27T01:00:00.000Z",
					completedAt: "2026-06-27T01:00:00.000Z",
				},
			),
		]);

		expect(view.sourceReviewId).toBe("review-new");
		expect(view.title).toBe("新しい依頼");
	});

	it("missing verificationCommands returns partial", () => {
		const view = buildScanImprovementRequestView([
			review({ improvementRequest: request({ verificationCommands: [] }) }),
		]);
		expect(view.available).toBe(true);
		expect(view.readiness).toBe("partial");
		expect(
			view.qualityChecks.find((item) => item.id === "verification")?.status,
		).toBe("partial");
	});

	it("missing handoffPrompt returns missing", () => {
		const view = buildScanImprovementRequestView([
			review({ improvementRequest: request({ handoffPrompt: "" }) }),
		]);
		expect(view.available).toBe(false);
		expect(view.readiness).toBe("missing");
	});

	it("malformed output.improvementRequest returns missing", () => {
		const view = buildScanImprovementRequestView([
			review({ improvementRequest: { title: "broken" } }),
		]);
		expect(view.available).toBe(false);
		expect(view.readiness).toBe("missing");
	});

	it("zero-finding handoff can be partial but not missing", () => {
		const view = buildScanImprovementRequestView([
			review({
				improvementRequest: request({
					scope: ["finding 0 件のため、カバレッジ確認を対象にする。"],
					priorityPlan: [],
					implementationTasks: [
						{
							title: "追加確認を行う",
							body: "静的解析の対象外領域を追加の自動診断で確認する。",
							findingIds: [],
							evidenceRefs: [],
						},
					],
					handoffPrompt:
						"finding 0 件は安全を証明しません。保存済み scan bundle に基づき追加確認してください。",
				}),
			}),
		]);
		expect(view.available).toBe(true);
		expect(view.readiness).toBe("partial");
		expect(view.qualityChecks.find((item) => item.id === "findings")?.status).toBe(
			"partial",
		);
	});
});

describe("getScanImprovementRequest", () => {
	it("null review returns null and false", () => {
		expect(getScanImprovementRequest(null)).toBeNull();
		expect(hasScanImprovementRequest(null)).toBe(false);
	});

	it("completed review without output returns null and false", () => {
		const item = review(null);
		expect(getScanImprovementRequest(item)).toBeNull();
		expect(hasScanImprovementRequest(item)).toBe(false);
	});

	it("malformed improvementRequest object returns null and false", () => {
		const item = review({ improvementRequest: { title: "broken" } });
		expect(getScanImprovementRequest(item)).toBeNull();
		expect(hasScanImprovementRequest(item)).toBe(false);
	});

	it("valid improvementRequest returns the typed request and true", () => {
		const expected = request();
		const item = review({ improvementRequest: expected });
		expect(getScanImprovementRequest(item)).toEqual(expected);
		expect(hasScanImprovementRequest(item)).toBe(true);
	});

	it("missing handoffPrompt returns null and false", () => {
		const item = review({
			improvementRequest: request({ handoffPrompt: "" }),
		});
		expect(getScanImprovementRequest(item)).toBeNull();
		expect(hasScanImprovementRequest(item)).toBe(false);
	});
});

describe("buildScanImprovementRequestMarkdown", () => {
	it("exports available sections without inventing missing sections", () => {
		const markdown = buildScanImprovementRequestMarkdown(
			request({ verificationCommands: [] }),
		);
		expect(markdown).toContain("# XSS 修正依頼");
		expect(markdown).toContain("## 引き継ぎプロンプト");
		expect(markdown).not.toContain("```bash");
	});
});

describe("classifyScanReviewFailure", () => {
	it("categorizes provider errors", () => {
		expect(
			classifyScanReviewFailure("llm_provider_execution_failed: 503")?.category,
		).toBe("provider_failure");
	});

	it("categorizes Japanese validation errors before generic validation", () => {
		expect(
			classifyScanReviewFailure(
				"llm_structured_output_validation_failed: Japanese review text is required at summary",
			)?.category,
		).toBe("japanese_language_validation_failure");
	});

	it("categorizes bundle reference violations", () => {
		expect(
			classifyScanReviewFailure("referenced findings not in bundle: bad")
				?.category,
		).toBe("bundle_reference_violation");
	});
});
