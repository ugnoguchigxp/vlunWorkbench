import { describe, expect, it } from "vitest";
import type { ImprovementWarningGroupSourceIssue } from "./scan-improvement-warning-group";
import { buildImprovementWarningGroups } from "./scan-improvement-warning-group";

const issueId = (index: number) =>
	`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const findingId = (index: number) =>
	`10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function issue(
	index: number,
	overrides: Partial<ImprovementWarningGroupSourceIssue> = {},
): ImprovementWarningGroupSourceIssue {
	return {
		issueId: issueId(index),
		rawFindingCount: 1,
		title: "Generic API key",
		description: "認証情報らしき値が検出されました。",
		severity: "high",
		location: { path: `src/file-${index}.ts`, startLine: index },
		familyKeys: ["family:generic-api-key"],
		scannerSignals: [
			{ sourceTool: "gitleaks", ruleId: "generic-api-key", severity: "high" },
		],
		evidence: [],
		identity: {
			issueKind: "secret",
			packageKey: null,
			advisoryIds: [],
		},
		...overrides,
	};
}

function members(issues: ImprovementWarningGroupSourceIssue[]) {
	return new Map(
		issues.map((item, index) => [item.issueId, [findingId(index + 1)]]),
	);
}

describe("improvement request warning rollup", () => {
	it("keeps nine matching issues as singletons", () => {
		const issues = Array.from({ length: 9 }, (_, index) => issue(index + 1));
		const result = buildImprovementWarningGroups(issues, members(issues));

		expect(result.groups).toHaveLength(9);
		expect(result.rollupParentCount).toBe(0);
		expect(result.singletonCount).toBe(9);
	});

	it("rolls ten matching issues into one parent with location children", () => {
		const issues = Array.from({ length: 10 }, (_, index) => issue(index + 1));
		const result = buildImprovementWarningGroups(issues, members(issues));

		expect(result.groups).toHaveLength(1);
		expect(result.groups[0]).toMatchObject({
			warningGroupId: "wg-000001",
			kind: "rollup",
			occurrenceCount: 10,
			rawFindingCount: 10,
			severity: "high",
			locationSummary: { total: 10, included: 10, omitted: 0 },
		});
		expect(result.groups[0]?.locations).toHaveLength(10);
		expect(result.manifest[0]?.issueIds).toHaveLength(10);
		expect(result.manifest[0]?.memberFindingIds).toHaveLength(10);
	});

	it("rolls 130 secret issues without exposing saved snippets", () => {
		const secret = "AKIA1234567890ABCDEF";
		const unrecognizedSecret = "opaque-value-that-redaction-does-not-recognize";
		const issues = Array.from({ length: 130 }, (_, index) =>
			issue(index + 1, {
				title: `Secret ${unrecognizedSecret}`,
				description: `Secret ${unrecognizedSecret} was detected`,
				location: {
					path: `secrets/${secret}-${index}.env`,
					startLine: index + 1,
					parameter: unrecognizedSecret,
					resource: unrecognizedSecret,
				},
				evidence: [
					{
						id: findingId(index + 1),
						kind: "tool-output",
						artifactId: null,
						location: null,
						snippet: `SECRET_SENTINEL ${secret}`,
					},
				],
			}),
		);
		const result = buildImprovementWarningGroups(issues, members(issues));

		expect(result.groups).toHaveLength(1);
		expect(result.groups[0]).toMatchObject({
			kind: "rollup",
			occurrenceCount: 130,
			locationSummary: { total: 130 },
		});
		expect(result.groups[0]?.representativeEvidence).not.toContainEqual(
			expect.objectContaining({ snippet: "SECRET_SENTINEL" }),
		);
		expect(
			result.groups[0]?.representativeEvidence.every(
				(evidence) => evidence.snippet === null,
			),
		).toBe(true);
		expect(result.manifest[0]?.issueIds).toHaveLength(130);
		expect(result.manifest[0]?.memberFindingIds).toHaveLength(130);
		expect(JSON.stringify(result.groups)).not.toContain(secret);
		expect(JSON.stringify(result.groups)).not.toContain(unrecognizedSecret);
	});

	it("rejects missing or overlapping finding membership", () => {
		const issues = [issue(1), issue(2)];
		expect(() =>
			buildImprovementWarningGroups(
				issues,
				new Map([[issues[0]!.issueId, [findingId(1)]]]),
			),
		).toThrow("warning_group_finding_membership_mismatch");
		expect(() =>
			buildImprovementWarningGroups(
				issues,
				new Map([
					[issues[0]!.issueId, [findingId(1)]],
					[issues[1]!.issueId, [findingId(1)]],
				]),
			),
		).toThrow("warning_group_finding_membership_overlap");
	});

	it("does not roll up incomplete or ineligible identities", () => {
		const issues = Array.from({ length: 10 }, (_, index) =>
			issue(index + 1, {
				identity: {
					issueKind: "unknown",
					packageKey: null,
					advisoryIds: [],
				},
			}),
		);
		const result = buildImprovementWarningGroups(issues, members(issues));

		expect(result.groups).toHaveLength(10);
		expect(result.rollupParentCount).toBe(0);
	});

	it("keeps dependency advisories with different identities separate", () => {
		const issues = Array.from({ length: 10 }, (_, index) =>
			issue(index + 1, {
				identity: {
					issueKind: "dependency",
					packageKey: "npm:lodash@4.17.20",
					advisoryIds: [`CVE-2026-${String(index).padStart(4, "0")}`],
				},
			}),
		);
		const result = buildImprovementWarningGroups(issues, members(issues));

		expect(result.groups).toHaveLength(10);
		expect(result.rollupParentCount).toBe(0);
	});

	it("uses the highest severity and records mixed severity counts", () => {
		const issues = Array.from({ length: 10 }, (_, index) =>
			issue(index + 1, {
				severity: index === 0 ? "critical" : "high",
				scannerSignals: [
					{
						sourceTool: "gitleaks",
						ruleId: "generic-api-key",
						severity: index === 0 ? "critical" : "high",
					},
				],
			}),
		);
		const result = buildImprovementWarningGroups(issues, members(issues));

		expect(result.groups[0]).toMatchObject({
			severity: "critical",
			severityCounts: { critical: 1, high: 9 },
		});
	});

	it("is stable when input order changes", () => {
		const issues = Array.from({ length: 12 }, (_, index) => issue(index + 1));
		const first = buildImprovementWarningGroups(issues, members(issues));
		const second = buildImprovementWarningGroups(
			[...issues].reverse(),
			members(issues),
		);

		expect(second).toEqual(first);
	});
});
