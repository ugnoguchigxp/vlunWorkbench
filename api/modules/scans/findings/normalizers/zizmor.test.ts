import { describe, expect, it } from "bun:test";
import { normalizeZizmor } from "./zizmor";

describe("zizmor normalizer", () => {
	it("maps zero-based workflow locations and CI integrity metadata", () => {
		const findings = normalizeZizmor([
			{
				ident: "template-injection",
				desc: "Template injection risk",
				url: "https://docs.zizmor.sh/audits/template-injection/",
				determinations: {
					confidence: "High",
					severity: "High",
					persona: "Pedantic",
				},
				locations: [
					{
						symbolic: {
							key: {
								Local: {
									verbatim_path: ".github/workflows/ci.yml",
								},
							},
							annotation: "untrusted input reaches run",
							kind: "Primary",
						},
						concrete: {
							location: {
								start_point: { row: 6, column: 2 },
								end_point: { row: 7, column: 12 },
							},
							feature: "run: echo ${{ github.event.issue.title }}",
						},
					},
				],
				ignored: false,
			},
		]);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			ruleId: "template-injection",
			severity: "high",
			primaryLocation: {
				path: ".github/workflows/ci.yml",
				startLine: 7,
				endLine: 8,
			},
			metadata: { scannerDomain: "cicd_workflow_integrity" },
		});
	});
});
