import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FindingDetailOverview } from "./finding-detail-overview";
import type { FindingDetailViewModel } from "./finding-detail-view-model";

const model = (
	overrides: Partial<FindingDetailViewModel> = {},
): FindingDetailViewModel => ({
	title: "CSP: Wildcard Directive",
	description: "A wildcard content security policy was detected.",
	severity: "medium",
	location: { kind: "web", path: "/account", method: "GET" },
	observation: { text: "Content-Security-Policy: default-src *", truncated: false },
	technical: {
		sourceTool: "zap-baseline",
		ruleId: "10055",
		toolConfidence: "High",
		cweIds: ["693"],
		wascIds: ["15"],
		artifacts: [
			{
				id: "artifact-1",
				label: "ZAP raw result",
				href: "/api/scans/scan-1/artifacts/artifact-1/download",
			},
		],
	},
	...overrides,
});

describe("FindingDetailOverview", () => {
	it("renders the simplified overview in the specified order", () => {
		const markup = renderToStaticMarkup(
			createElement(FindingDetailOverview, { model: model() }),
		);

		expect(markup).toContain("検出内容");
		expect(markup).toContain("検出位置");
		expect(markup).toContain("検出した事実");
		expect(markup).toContain("技術詳細");
		expect(markup.indexOf("検出内容")).toBeLessThan(markup.indexOf("検出位置"));
		expect(markup.indexOf("検出位置")).toBeLessThan(markup.indexOf("検出した事実"));
		expect(markup).toContain("GET");
		expect(markup).toContain("/account");
		expect(markup).toContain("ZAP raw result");
		expect(markup).not.toContain("LLM");
		expect(markup).not.toContain("修正計画");
		expect(markup).not.toContain("優先度");
		expect(markup).not.toContain("検証タブで確認");
	});

	it("omits optional sections and displays truncation only when needed", () => {
		const markup = renderToStaticMarkup(
			createElement(FindingDetailOverview, {
				model: model({
					location: null,
					observation: null,
					technical: {
						sourceTool: "semgrep",
						ruleId: "rule-1",
						toolConfidence: null,
						cweIds: [],
						wascIds: [],
						artifacts: [],
					},
				}),
			}),
		);

		expect(markup).not.toContain("検出位置");
		expect(markup).not.toContain("検出した事実");
		expect(markup).not.toContain("先頭2,000文字を表示");
		expect(markup).not.toContain("生の証跡");
	});

	it("shows the truncation note for a truncated observation", () => {
		const markup = renderToStaticMarkup(
			createElement(FindingDetailOverview, {
				model: model({ observation: { text: "truncated", truncated: true } }),
			}),
		);

		expect(markup).toContain("先頭2,000文字を表示");
	});
});
