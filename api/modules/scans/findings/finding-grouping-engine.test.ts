import { describe, expect, it } from "vitest";
import {
	buildFindingGroups,
	decideFindingPair,
	type FindingForGrouping,
} from "./finding-grouping-engine";
import { projectFindingDedupeIdentity } from "./finding-dedupe-identity";

const id = (suffix: string) => `00000000-0000-4000-8000-0000000000${suffix}`;

function finding(
	suffix: string,
	overrides: Partial<FindingForGrouping> = {},
): FindingForGrouping {
	return {
		id: id(suffix),
		sourceTool: "semgrep",
		ruleId: "javascript.lang.security.xss",
		title: "Cross-site scripting",
		description: "Unsanitized user input reaches HTML output.",
		severity: "high",
		confidence: "static",
		primaryLocation: { path: "src/view.ts", startLine: 10, endLine: 12 },
		metadata: { cweIds: ["CWE-79"] },
		...overrides,
	};
}

describe("deterministic finding grouping", () => {
	it("merges matching dependency advisories across scanners", () => {
		const result = buildFindingGroups([
			finding("01", {
				sourceTool: "osv",
				ruleId: "GHSA-ABCD-1234-EFGH",
				severity: "high",
				primaryLocation: { path: "package-lock.json" },
				metadata: {
					ecosystem: "npm",
					packageName: "lodash",
					packageVersion: "4.17.20",
					manifestPath: "package-lock.json",
					advisoryId: "GHSA-ABCD-1234-EFGH",
					aliases: ["CVE-2020-8203"],
				},
			}),
			finding("02", {
				sourceTool: "trivy",
				ruleId: "CVE-2020-8203",
				severity: "critical",
				primaryLocation: { path: "package-lock.json" },
				metadata: {
					type: "npm",
					packageName: "lodash",
					installedVersion: "4.17.20",
					target: "package-lock.json",
					vulnerabilityId: "CVE-2020-8203",
					aliases: ["GHSA-ABCD-1234-EFGH"],
				},
			}),
		]);

		expect(result.groups).toHaveLength(1);
		expect(result.groups[0]).toMatchObject({
			severity: "critical",
			matchConfidence: "exact",
			memberFindingIds: [id("01"), id("02")],
		});
	});

	it("does not bridge merge when only adjacent ranges overlap", () => {
		const result = buildFindingGroups([
			finding("11", { primaryLocation: { path: "src/view.ts", startLine: 1, endLine: 5 } }),
			finding("12", { primaryLocation: { path: "src/view.ts", startLine: 4, endLine: 8 } }),
			finding("13", { primaryLocation: { path: "src/view.ts", startLine: 7, endLine: 11 } }),
		]);

		expect(result.groups).toHaveLength(2);
		expect(result.groups.map((group) => group.memberFindingIds.length).sort()).toEqual([1, 2]);
	});

	it("keeps a missing-column secret relation ambiguous", () => {
		const first = finding("21", {
			sourceTool: "gitleaks",
			ruleId: "generic-api-key",
			primaryLocation: { path: ".env", startLine: 1, endLine: 1, startCol: 1, endCol: 20 },
			metadata: { detectorFamily: "generic-api-key" },
		});
		const second = finding("22", {
			sourceTool: "trivy",
			ruleId: "generic-api-key",
			primaryLocation: { path: ".env", startLine: 1, endLine: 1 },
			metadata: { class: "secret", detectorFamily: "generic-api-key" },
		});
		const decision = decideFindingPair(
			{ ...first, identity: projectFindingDedupeIdentity(first) },
			{ ...second, identity: projectFindingDedupeIdentity(second) },
		);

		expect(decision).toMatchObject({ verdict: "ambiguous", reasonCodes: ["column_range_missing"] });
		expect(buildFindingGroups([first, second]).groups).toHaveLength(2);
	});

	it("does not retain a secret value in a persisted group projection", () => {
		const result = buildFindingGroups([
			finding("23", {
				sourceTool: "gitleaks",
				ruleId: "generic-api-key",
				title: "AKIAIOSFODNN7EXAMPLE",
				description: "AKIAIOSFODNN7EXAMPLE was detected in the source file.",
				primaryLocation: {
					path: ".env",
					startLine: 1,
					endLine: 1,
					startCol: 1,
					endCol: 20,
				},
				metadata: { detectorFamily: "generic-api-key" },
			}),
		]);

		expect(result.groups[0]).toMatchObject({
			title: "認証情報らしき値の検出",
			description: expect.not.stringContaining("AKIAIOSFODNN7EXAMPLE"),
		});
	});

	it("records an explicit limitation when the pair budget is exhausted", () => {
		const result = buildFindingGroups(
			[finding("31"), finding("32"), finding("33")],
			{ maxPairComparisons: 1 },
		);

		expect(result.limitations).toEqual(["deterministic_pair_budget_exceeded"]);
		expect(result.ambiguousCount).toBe(2);
	});
});
