import { describe, expect, test } from "bun:test";
import packageManifest from "../package.json";
import { STRICT_VERIFY_COMMANDS, VERIFY_STEPS } from "./verify-steps";

describe("verification command graph", () => {
	test("keeps policy checks before tests and build", () => {
		expect(VERIFY_STEPS.map((step) => step.label)).toEqual([
			"sqlite-write-boundary",
			"s11tnext",
			"typecheck",
			"lint",
			"format",
			"source-size-budget",
			"dependency-override-docs",
			"security-capability-docs",
			"test",
			"build",
			"bundle-budget",
			"dependency-audit",
			"artifact-tracking",
		]);
	});

	test("strict verification includes capability evidence, coverage, and browser E2E", () => {
		expect(packageManifest.scripts["verify:strict"]).toBe(
			"bun run scripts/verify-strict.ts",
		);
		expect(STRICT_VERIFY_COMMANDS).toEqual([
			["bun", "run", "verify"],
			["bun", "run", "test:detection-effectiveness"],
			["bun", "run", "test:security-capability"],
			["bun", "run", "verify:phase-51-baseline"],
			["bun", "run", "verify:dast-capability"],
			["bun", "run", "verify:phase-54-baseline"],
			["bun", "run", "verify:phase-50-evidence"],
			["bun", "run", "test:coverage"],
			["bun", "run", "test:e2e"],
		]);
	});
});
