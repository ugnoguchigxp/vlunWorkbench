import { describe, expect, it } from "vitest";
import type { ScanReport, ScanReview } from "../../../api";
import {
	hasLlmComment,
	llmCommentTitle,
	selectWorkspaceReportId,
} from "./report-workspace-view-model";

const report = (id: string): ScanReport => ({
	id,
	scanRunId: "scan-1",
	artifactId: "artifact-1",
	format: "markdown",
	title: "診断レポート",
	summary: null,
	options: {
		includeFalsePositives: false,
		includeDeferred: false,
		includeUndecided: true,
	},
	status: "completed",
	stage: "canonical_final",
	errorMessage: null,
	generatedByUserId: "user-1",
	createdAt: "2026-08-20T00:00:00.000Z",
	updatedAt: "2026-08-20T00:00:00.000Z",
});

const review = (overrides: Partial<ScanReview> = {}): ScanReview => ({
	id: "review-1",
	scanRunId: "scan-1",
	projectId: "project-1",
	provider: "openai",
	model: "model",
	status: "completed",
	summary: null,
	riskOverview: "最優先の修正を確認してください。",
	priorityNotes: [],
	coverageNotes: [],
	falsePositiveHotspots: [],
	recommendedNextActions: [],
	findingTriageHints: [],
	confidenceNotes: [],
	errorMessage: null,
	createdAt: "2026-08-20T00:00:00.000Z",
	startedAt: null,
	completedAt: "2026-08-20T00:00:01.000Z",
	updatedAt: "2026-08-20T00:00:01.000Z",
	...overrides,
});

describe("report workspace view model", () => {
	it("uses a valid requested report and otherwise falls back to the canonical final", () => {
		expect(selectWorkspaceReportId([report("new"), report("old")], "old")).toBe("old");
		expect(selectWorkspaceReportId([report("new")], "missing")).toBe("new");
		expect(
			selectWorkspaceReportId([
				{ ...report("preliminary"), stage: "preliminary" },
				report("final"),
			]),
		).toBe("final");
		expect(
			selectWorkspaceReportId([{ ...report("preliminary"), stage: "preliminary" }]),
		).toBeNull();
		expect(selectWorkspaceReportId([])).toBeNull();
});

	it("only exposes a completed LLM review with visible commentary", () => {
		expect(hasLlmComment(review())).toBe(true);
		expect(hasLlmComment(review({ status: "running" }))).toBe(false);
		expect(
			hasLlmComment(
				review({ riskOverview: null, summary: null, priorityNotes: [], recommendedNextActions: [] }),
			),
		).toBe(false);
		expect(llmCommentTitle(review())).toBe("最優先の修正を確認してください。");
	});
});
