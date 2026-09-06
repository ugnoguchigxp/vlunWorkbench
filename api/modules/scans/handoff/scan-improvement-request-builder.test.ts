import { describe, expect, it } from "bun:test";
import type { LlmIssueImprovementRequest } from "../../../../shared/schemas/scan.schema";
import type { ImprovementRequestIssueBundle } from "./scan-improvement-issue-bundle";
import {
	parseIssueChunkImprovementRequest,
	StructuredImprovementRequestError,
} from "./scan-improvement-request-builder";

const issueId = "00000000-0000-4000-8000-000000000101";
const findingId = "00000000-0000-4000-8000-000000000201";
const artifactId = "00000000-0000-4000-8000-000000000301";
const evidenceId = "00000000-0000-4000-8000-000000000401";

function issueBundle(): ImprovementRequestIssueBundle {
	return {
		artifacts: [
			{
				id: artifactId,
				toolRunId: null,
				kind: "sarif",
				format: "json",
			},
		],
		issueManifest: [{ issueId, memberFindingIds: [findingId] }],
		issues: [
			{
				issueId,
				representativeFindingId: findingId,
				rawFindingCount: 1,
				title: "保存済みの入力検証不備",
				description: "保存済み証跡から確認した入力検証の不備です。",
				severity: "high",
				location: { path: "src/app.ts", startLine: 7 },
				familyKeys: [],
				scannerSignals: [],
				evidence: [
					{
						id: evidenceId,
						kind: "source-location",
						artifactId,
						location: { path: "src/app.ts", startLine: 7 },
						snippet: "保存済みコード",
					},
				],
				identity: {
					issueKind: "code",
					packageKey: null,
					advisoryIds: [],
				},
				grouping: { confidence: "exact", reasonCodes: [] },
			},
		],
	} as unknown as ImprovementRequestIssueBundle;
}

function issueRequest(): LlmIssueImprovementRequest {
	return {
		title: "入力検証を修正する",
		objective: "保存済み証跡に基づいて入力検証を修正する。",
		scope: ["保存された対象箇所を修正する。"],
		priorityPlan: [
			{
				priority: "high",
				rationale: "外部入力を扱うため優先して修正する。",
				issueIds: [issueId],
			},
		],
		implementationTasks: [
			{
				title: "入力値を検証する",
				body: "許可する形式を限定し、境界条件の回帰テストを追加する。",
				issueIds: [issueId],
				evidenceRefs: [artifactId, evidenceId, "src/app.ts", "src/app.ts:7"],
			},
		],
		acceptanceCriteria: ["不正な入力が拒否されることを確認する。"],
		verificationCommands: ["既存のテストを実行する"],
		constraints: ["保存済み証跡の範囲で判断する。"],
		nonGoals: ["対象外の機能は変更しない。"],
		handoffPrompt: "保存済み証跡に従って修正してください。",
	};
}

describe("parseIssueChunkImprovementRequest", () => {
	it("validates saved issue and evidence references before expanding finding IDs", () => {
		const parsed = parseIssueChunkImprovementRequest(
			`回答です。\n\`\`\`json\n${JSON.stringify(issueRequest())}\n\`\`\``,
			issueBundle(),
		);

		expect(parsed.priorityPlan[0]).toMatchObject({
			issueIds: [issueId],
			findingIds: [findingId],
		});
		expect(parsed.implementationTasks[0]).toMatchObject({
			issueIds: [issueId],
			findingIds: [findingId],
		});
	});

	it("rejects issue IDs outside the persisted manifest", () => {
		const request = issueRequest();
		request.priorityPlan[0]!.issueIds = [
			"00000000-0000-4000-8000-000000000999",
		];
		expect(() =>
			parseIssueChunkImprovementRequest(
				JSON.stringify(request),
				issueBundle(),
			),
		).toThrow("outside the saved bundle");
	});

	it("requires every persisted issue to appear in an implementation task", () => {
		const request = issueRequest();
		request.implementationTasks[0]!.issueIds = [];
		expect(() =>
			parseIssueChunkImprovementRequest(
				JSON.stringify(request),
				issueBundle(),
			),
		).toThrow("did not cover every issue");
	});

	it("rejects invented evidence locations and malformed provider output", () => {
		const request = issueRequest();
		request.implementationTasks[0]!.evidenceRefs = ["src/invented.ts:99"];
		expect(() =>
			parseIssueChunkImprovementRequest(
				JSON.stringify(request),
				issueBundle(),
			),
		).toThrow("outside the saved issue bundle");
		expect(() =>
			parseIssueChunkImprovementRequest("応答にJSONがありません", issueBundle()),
		).toThrow(StructuredImprovementRequestError);
	});
});
