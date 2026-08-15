import { describe, expect, it } from "bun:test";
import type { ProfileToolEntry } from "../../../shared/schemas/scan-profile.schema";
import { buildDiffScanPlan } from "../scans/diff-scan-plan";
import type { ResolvedGitDiff } from "../scans/git-diff-resolver";
import { observeDependencyChange } from "./dependency-change-observer";

const tools: ProfileToolEntry[] = [
	{
		toolId: "osv",
		displayName: "OSV",
		required: true,
		failurePolicy: "fail_profile",
	},
	{
		toolId: "trivy",
		displayName: "Trivy",
		required: false,
		failurePolicy: "warn_and_continue",
	},
];

describe("dependency change observer", () => {
	it.each([
		["package-lock.json", "npm dependencies"],
		["pom.xml", "Maven dependencies"],
		["build.gradle.kts", "Gradle dependencies"],
		["requirements-prod.txt", "Python requirements"],
		["go.mod", "Go modules"],
	])("observes %s from the saved diff manifest", (path, ecosystem) => {
		const plan = buildPlan([path], [path]);
		const observation = observeDependencyChange({
			manifest: plan.manifest,
			toolApplicability: plan.tools,
		});

		expect(observation.dependencyStateChanged).toBe(true);
		expect(observation.affectedEcosystems).toContain(ecosystem);
		expect(observation.covered).toContain(`${ecosystem} change scope`);
	});

	it("does not turn an unrelated change into a tested dependency claim", () => {
		const plan = buildPlan(["src/app.ts"], ["src/app.ts"]);
		const observation = observeDependencyChange({
			manifest: plan.manifest,
			toolApplicability: plan.tools,
		});

		expect(observation).toMatchObject({
			dependencyStateChanged: false,
			affectedEcosystems: [],
		});
		expect(observation.limitationCodes).toContain(
			"dependency_change_not_observed",
		);
	});

	it("derives the observation from entries instead of denormalized flags", () => {
		const plan = buildPlan(["package-lock.json"], ["package-lock.json"]);
		plan.manifest.pluginContext.dependencyStateChanged = false;
		plan.manifest.pluginContext.lockStateChanged = false;
		plan.manifest.pluginContext.affectedPluginIds = [];

		const observation = observeDependencyChange({
			manifest: plan.manifest,
			toolApplicability: plan.tools,
		});

		expect(observation).toMatchObject({
			dependencyStateChanged: true,
			lockStateChanged: true,
			affectedEcosystems: ["npm dependencies"],
		});
	});

	it("preserves dependency and diff coverage limitations without paths", () => {
		const plan = buildPlan(["build.gradle.kts"], ["build.gradle.kts"]);
		plan.manifest.coverage.tooLarge = 1;
		const observation = observeDependencyChange({
			manifest: plan.manifest,
			toolApplicability: plan.tools,
		});

		expect(observation.limitationCodes).toEqual(
			expect.arrayContaining([
				"diff_contains_oversized_paths",
				"gradle_dependency_lock_missing",
				"osv_dependency_coverage_gap",
			]),
		);
		expect(JSON.stringify(observation)).not.toContain("build.gradle.kts");
	});
});

function buildPlan(changedPaths: string[], inventoryPaths: string[]) {
	return buildDiffScanPlan({
		resolved: resolved(changedPaths.map(entry)),
		tools,
		projectInventoryPaths: inventoryPaths,
	});
}

function resolved(entries: ResolvedGitDiff["entries"]): ResolvedGitDiff {
	return {
		gitRoot: "/fixture",
		projectRoot: "/fixture",
		projectPrefix: "",
		requested: { kind: "range", base: "base", head: "head" },
		baseSha: "a".repeat(40),
		headSha: "b".repeat(40),
		mergeBaseSha: "a".repeat(40),
		includeUntracked: false,
		entries,
	};
}

function entry(path: string): ResolvedGitDiff["entries"][number] {
	return {
		status: "modified",
		path,
		contentSha256: "c".repeat(64),
		sizeBytes: 10,
		binary: false,
		inProfileScope: true,
		disposition: "scan",
		reasonCode: null,
	};
}
