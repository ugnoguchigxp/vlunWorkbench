import { describe, expect, it } from "vitest";
import type { ImprovementWarningGroupPrompt } from "./scan-improvement-warning-group";
import {
	ImprovementRequestPromptBudgetError,
	packImprovementWarningGroups,
} from "./scan-improvement-prompt-budget";

function group(
	index: number,
	overrides: Partial<ImprovementWarningGroupPrompt> = {},
): ImprovementWarningGroupPrompt {
	return {
		warningGroupId: "wg-" + String(index).padStart(6, "0"),
		kind: "singleton",
		issueKind: "source",
		title: "警告 " + index,
		description: "検出内容です。",
		severity: "high",
		severityCounts: { high: 1 },
		occurrenceCount: 1,
		rawFindingCount: 1,
		scannerSignals: [
			{ sourceTool: "semgrep", ruleId: "rule-" + index, severity: "high" },
		],
		familyKeys: ["rule:semgrep:rule-" + index],
		representativeEvidence: [],
		locations: [
			{
				ref: "src/file-" + index + ".ts:1",
				path: "src/file-" + index + ".ts",
				startLine: 1,
				endLine: 1,
				startCol: null,
				endCol: null,
				resource: null,
				method: null,
				parameter: null,
				severity: "high",
			},
		],
		locationSummary: {
			total: 1,
			included: 1,
			omitted: 0,
			digest: "sha256:" + String(index).padStart(64, "0"),
		},
		compressionTier: 0,
		...overrides,
	};
}

const render = (
	warningGroups: ImprovementWarningGroupPrompt[],
	offset: number,
	index: number,
	count: number,
) => JSON.stringify({ offset, index, count, shared: "x".repeat(100), warningGroups });

describe("improvement request prompt budget", () => {
	it("packs groups by rendered characters instead of item count", () => {
		const groups = Array.from({ length: 12 }, (_, index) =>
			group(index + 1, { description: "長".repeat(1_000) }),
		);
		const chunks = packImprovementWarningGroups({
			warningGroups: groups,
			render,
			targetChars: 4_000,
			hardChars: 5_000,
		});

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.renderedChars <= 4_000)).toBe(true);
		expect(chunks.flatMap((chunk) => chunk.warningGroups)).toHaveLength(12);
	});

	it("compresses one oversized parent without splitting it", () => {
		const locations = Array.from({ length: 130 }, (_, index) => ({
			ref: "src/file-" + index + ".ts:" + (index + 1),
			path: "src/file-" + index + ".ts",
			startLine: index + 1,
			endLine: index + 1,
			startCol: null,
			endCol: null,
			resource: null,
			method: null,
			parameter: null,
			severity: "high" as const,
		}));
		const oversized = group(1, {
			kind: "rollup",
			occurrenceCount: 130,
			locations,
			locationSummary: {
				total: 130,
				included: 130,
				omitted: 0,
				digest: "sha256:" + "a".repeat(64),
			},
		});
		const chunks = packImprovementWarningGroups({
			warningGroups: [oversized],
			render,
			targetChars: 4_500,
			hardChars: 5_000,
		});

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.warningGroups).toHaveLength(1);
		expect(chunks[0]?.warningGroups[0]).toMatchObject({
			compressionTier: 2,
			locationSummary: { total: 130, included: 20, omitted: 110 },
		});
	});

	it("fails before provider execution when compact input exceeds the hard limit", () => {
		expect(() =>
			packImprovementWarningGroups({
				warningGroups: [group(1)],
				render: () => "x".repeat(3_001),
				targetChars: 2_500,
				hardChars: 3_000,
			}),
		).toThrow(ImprovementRequestPromptBudgetError);
	});
});
