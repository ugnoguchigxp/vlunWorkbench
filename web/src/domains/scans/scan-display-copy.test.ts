import { describe, expect, it } from "vitest";
import { formatFindingTitle, formatSeverityLabel } from "./scan-display-copy";

describe("scan display copy", () => {
	it("translates known finding titles and preserves unknown titles", () => {
		expect(formatFindingTitle("Missing common security header")).toBe(
			"一般的なセキュリティヘッダーが不足",
		);
		expect(formatFindingTitle("A custom finding")).toBe("A custom finding");
	});

	it("translates severity values case-insensitively and handles fallbacks", () => {
		expect(formatSeverityLabel("HIGH")).toBe("高");
		expect(formatSeverityLabel(null)).toBe("不明");
		expect(formatSeverityLabel("new-severity")).toBe("new-severity");
	});
});
