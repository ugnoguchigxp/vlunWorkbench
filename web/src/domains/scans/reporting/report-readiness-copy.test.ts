import { describe, expect, it } from "vitest";
import {
	buildGenerationWarning,
	getReportReadinessCopy,
	getReportSubmissionLevel,
} from "./report-readiness-copy";

describe("report readiness copy", () => {
	it("maps readiness to submission level labels", () => {
		expect(
			getReportReadinessCopy(getReportSubmissionLevel("ready"))
				.primaryActionLabel,
		).toBe("提出用レポートを生成");
		expect(
			getReportReadinessCopy(getReportSubmissionLevel("partial"))
				.primaryActionLabel,
		).toBe("内部レビュー用ドラフトを生成");
		expect(
			getReportReadinessCopy(getReportSubmissionLevel("blocked"))
				.primaryActionLabel,
		).toBe("レビュー用ドラフトを生成");
	});

	it("does not create warning copy for non-ready states", () => {
		expect(
				buildGenerationWarning({
					readiness: "partial",
					missingInputs: [],
					partialReasons: ["baseline 比較を利用できません。"],
				}),
		).toBeNull();
		expect(
				buildGenerationWarning({
					readiness: "blocked",
					missingInputs: [
						"修正計画が不足",
						"finding 0 件のカバレッジ説明が不足",
					],
					partialReasons: [],
				}),
		).toBeNull();
		expect(
			buildGenerationWarning({
				readiness: "ready",
				missingInputs: [],
				partialReasons: [],
			}),
		).toBeNull();
	});
});
