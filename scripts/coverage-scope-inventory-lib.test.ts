import { describe, expect, test } from "bun:test";
import {
	classifyProductionFiles,
	matchesCoveragePattern,
	type CoverageScopePolicy,
} from "./coverage-scope-inventory-lib";

const policy: CoverageScopePolicy = {
	version: 1,
	selectedWebPatterns: ["web/src/domains/*.ts"],
	criticalSurfacePatterns: [],
	criticalSurfaceExemptionBaseline: 0,
	criticalSurfaceExemptions: [],
	e2eOnly: [
		{
			path: "web/src/controller.ts",
			testId: "E2E-CONTROLLER",
			spec: "tests/e2e/example.spec.ts",
			title: "controller flow",
		},
	],
};

describe("coverage scope inventory", () => {
	test("matches only one path segment for a selected Web wildcard", () => {
		expect(matchesCoveragePattern("web/src/domains/model.ts", "web/src/domains/*.ts")).toBe(true);
		expect(matchesCoveragePattern("web/src/domains/nested/model.ts", "web/src/domains/*.ts")).toBe(false);
	});

	test("classifies every production file with E2E exclusions taking precedence", () => {
		const files = [
			"api/middleware/auth.ts",
			"web/src/domains/model.ts",
			"web/src/controller.ts",
			"api/modules/example.ts",
		];
		expect(classifyProductionFiles(files, policy)).toEqual([
			{ path: "api/middleware/auth.ts", classification: "critical_api" },
			{ path: "web/src/domains/model.ts", classification: "selected_web" },
			{ path: "web/src/controller.ts", classification: "e2e_only" },
			{ path: "api/modules/example.ts", classification: "unmeasured" },
		]);
	});
});
