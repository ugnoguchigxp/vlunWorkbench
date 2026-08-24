import { describe, expect, it } from "vitest";
import { StructuredImprovementRequestError } from "./scan-improvement-request-builder";
import type { ImprovementRequestIssueBundle } from "./scan-improvement-issue-bundle";
import { parseWarningGroupChunkImprovementRequest } from "./scan-improvement-warning-request";

const issueId1 = "00000000-0000-4000-8000-000000000001";
const issueId2 = "00000000-0000-4000-8000-000000000002";
const findingId1 = "00000000-0000-4000-8000-000000000101";
const findingId2 = "00000000-0000-4000-8000-000000000102";
const evidenceId = "00000000-0000-4000-8000-000000000201";

function bundle(): ImprovementRequestIssueBundle {
	return {
		artifacts: [],
		warningGroupManifest: [
			{
				warningGroupId: "wg-000001",
				issueIds: [issueId1],
				memberFindingIds: [findingId1],
				severity: "high",
			},
			{
				warningGroupId: "wg-000002",
				issueIds: [issueId2],
				memberFindingIds: [findingId2],
				severity: "high",
			},
		],
		warningGroups: [
			{
				warningGroupId: "wg-000001",
				representativeEvidence: [
					{ id: evidenceId, kind: "source-location", artifactId: null },
				],
				locations: [{ ref: "src/a.ts:10" }],
			},
			{
				warningGroupId: "wg-000002",
				representativeEvidence: [],
				locations: [{ ref: "src/b.ts:20" }],
			},
		],
	} as unknown as ImprovementRequestIssueBundle;
}

function response() {
	return {
		title: "セキュリティ改修依頼",
		objective: "保存済みの警告を修正する。",
		scope: ["提示された警告グループを対象にする。"],
		priorityPlan: [
			{
				priority: "high",
				rationale: "重大度の高い警告から対応する。",
				warningGroupIds: ["wg-000001", "wg-000002"],
			},
		],
		implementationTasks: [
			{
				title: "警告を修正する",
				body: "該当箇所を確認し、最小の修正と回帰テストを追加する。",
				warningGroupIds: ["wg-000001", "wg-000002"],
				evidenceRefs: [evidenceId, "src/b.ts:20"],
			},
		],
		acceptanceCriteria: ["対象警告の修正をテストで確認できる。"],
		verificationCommands: [],
		constraints: ["保存済み証跡を根拠にする。"],
		nonGoals: ["無関係な機能変更は行わない。"],
		handoffPrompt: "対象リポジトリを確認して修正と検証を行ってください。",
	};
}

describe("parseWarningGroupChunkImprovementRequest", () => {
	it("expands warning group IDs to saved issue and finding IDs", () => {
		const parsed = parseWarningGroupChunkImprovementRequest(
			JSON.stringify(response()),
			bundle(),
		);

		expect(parsed.implementationTasks[0]).toMatchObject({
			warningGroupIds: ["wg-000001", "wg-000002"],
			issueIds: [issueId1, issueId2],
			findingIds: [findingId1, findingId2],
		});
	});

	it("rejects unknown warning group IDs", () => {
		const invalid = response();
		invalid.implementationTasks[0]!.warningGroupIds = ["wg-999999"];

		expect(() =>
			parseWarningGroupChunkImprovementRequest(
				JSON.stringify(invalid),
				bundle(),
			),
		).toThrow(StructuredImprovementRequestError);
	});

	it("requires each warning group exactly once in implementation tasks", () => {
		const invalid = response();
		invalid.implementationTasks.push({
			...invalid.implementationTasks[0]!,
			warningGroupIds: ["wg-000001"],
		});

		expect(() =>
			parseWarningGroupChunkImprovementRequest(
				JSON.stringify(invalid),
				bundle(),
			),
		).toThrow(/exactly once/);
	});

	it("rejects a location reference that was not shown to the model", () => {
		const invalid = response();
		invalid.implementationTasks[0]!.evidenceRefs = ["src/unknown.ts:99"];

		expect(() =>
			parseWarningGroupChunkImprovementRequest(
				JSON.stringify(invalid),
				bundle(),
			),
		).toThrow(StructuredImprovementRequestError);
	});

	it("rejects evidence from a warning group outside the task", () => {
		const invalid = response();
		invalid.implementationTasks = [
			{
				...invalid.implementationTasks[0]!,
				warningGroupIds: ["wg-000001"],
				evidenceRefs: ["src/b.ts:20"],
			},
			{
				...invalid.implementationTasks[0]!,
				warningGroupIds: ["wg-000002"],
				evidenceRefs: ["src/b.ts:20"],
			},
		];

		expect(() =>
			parseWarningGroupChunkImprovementRequest(
				JSON.stringify(invalid),
				bundle(),
			),
		).toThrow(/outside the saved warning group bundle/);
	});

	it("accepts a UUID-shaped location reference", () => {
		const savedBundle = bundle();
		savedBundle.warningGroups[1]!.locations = [{
			...savedBundle.warningGroups[1]!.locations[0]!,
			ref: findingId2,
		}];
		const valid = response();
		valid.implementationTasks[0]!.evidenceRefs = [findingId2];

		expect(() =>
			parseWarningGroupChunkImprovementRequest(
				JSON.stringify(valid),
				savedBundle,
			),
		).not.toThrow();
	});

	it("rejects priority above the saved scanner severity", () => {
		const savedBundle = bundle();
		savedBundle.warningGroupManifest[1]!.severity = "medium";
		const invalid = response();
		invalid.priorityPlan = [
			{
				priority: "critical",
				rationale: "最優先で対応する。",
				warningGroupIds: ["wg-000002"],
			},
		];

		expect(() =>
			parseWarningGroupChunkImprovementRequest(
				JSON.stringify(invalid),
				savedBundle,
			),
		).toThrow(/priority exceeded/);
	});

	it("accepts a coverage priority when a zero-finding bundle has no warning groups", () => {
		const savedBundle = bundle();
		savedBundle.warningGroupManifest = [];
		savedBundle.warningGroups = [];
		const coverageRequest = response();
		coverageRequest.priorityPlan = [
			{
				priority: "medium",
				rationale: "未検査領域の確認を継続する。",
				warningGroupIds: [],
			},
		];
		coverageRequest.implementationTasks[0]!.warningGroupIds = [];
		coverageRequest.implementationTasks[0]!.evidenceRefs = [];

		expect(() =>
			parseWarningGroupChunkImprovementRequest(
				JSON.stringify(coverageRequest),
				savedBundle,
			),
		).not.toThrow();
	});
});
