import { describe, expect, it } from "bun:test";
import type { ProfileToolEntry } from "../../../shared/schemas/scan-profile.schema";
import {
	buildDiffScanPlan,
	canonicalJson,
} from "./diff-scan-plan";
import type { ResolvedGitDiff } from "./git-diff-resolver";

const tools: ProfileToolEntry[] = [
	{
		toolId: "semgrep",
		displayName: "Semgrep",
		required: true,
		failurePolicy: "fail_profile",
	},
	{
		toolId: "gitleaks",
		displayName: "Gitleaks",
		required: true,
		failurePolicy: "fail_profile",
	},
	{
		toolId: "osv",
		displayName: "OSV",
		required: false,
		failurePolicy: "warn_and_continue",
	},
	{
		toolId: "trivy",
		displayName: "Trivy",
		required: false,
		failurePolicy: "warn_and_continue",
	},
];

describe("diff scan plan", () => {
	it("builds deterministic target identity and per-tool applicability", () => {
		const input = resolved([
			entry("src/app.ts"),
			entry("package-lock.json"),
			{
				...entry("old.ts"),
				status: "deleted",
				disposition: "deleted",
				reasonCode: "deleted_path",
				contentSha256: undefined,
				sizeBytes: undefined,
			},
		]);
		const first = buildDiffScanPlan({ resolved: input, tools });
		const second = buildDiffScanPlan({ resolved: input, tools });

		expect(first.target.targetDigest).toBe(second.target.targetDigest);
		expect(first.manifest.coverage).toEqual({
			changed: 3,
			scannable: 2,
			deleted: 1,
			excluded: 0,
			unsupported: 0,
			tooLarge: 0,
		});
		expect(first.dependencyChanged).toBe(true);
		expect(
			first.tools.find((tool) => tool.toolId === "osv")?.applicability,
		).toBe("applicable");
	});

	it("skips dependency scanning when no manifest changed", () => {
		const plan = buildDiffScanPlan({
			resolved: resolved([entry("src/app.ts")]),
			tools,
		});

		expect(plan.tools.find((tool) => tool.toolId === "osv")).toMatchObject({
			applicability: "not_applicable",
			reasonCode: "no_dependency_manifest_changed",
			coverageEffect: "covered",
		});
		expect(plan.tools.find((tool) => tool.toolId === "semgrep")).toMatchObject({
			applicability: "applicable",
			reasonCode: null,
		});
	});

	it("makes Maven and Gradle dependency changes applicable", () => {
		const maven = buildDiffScanPlan({
			resolved: resolved([entry("services/orders/pom.xml")]),
			tools,
		});
		expect(maven.dependencyChanged).toBe(true);
		expect(maven.pluginContext.affectedPluginIds).toContain("build.maven");
		expect(maven.pluginContext.lockStateChanged).toBe(false);
		expect(maven.pluginContext.limitationCodes).toEqual(
			expect.arrayContaining([
				"maven_direct_dependencies_only",
				"dependency_resolution_not_performed",
			]),
		);
		expect(
			maven.tools.find((tool) => tool.toolId === "osv",
			),
		).toMatchObject({
			applicability: "applicable",
			coverageEffect: "partial",
		});

		const gradleDefinitionOnly = buildDiffScanPlan({
			resolved: resolved([entry("build.gradle.kts")]),
			tools,
		});
		expect(gradleDefinitionOnly.pluginContext.limitationCodes).toContain(
			"gradle_dependency_lock_missing",
		);
		expect(
			gradleDefinitionOnly.tools.find((tool) => tool.toolId === "osv"),
		).toMatchObject({
			applicability: "applicable",
			coverageEffect: "gap",
		});

		const gradleVerificationOnly = buildDiffScanPlan({
			resolved: resolved([entry("gradle/verification-metadata.xml")]),
			tools,
		});
		expect(gradleVerificationOnly.pluginContext).toMatchObject({
			dependencyStateChanged: true,
			lockStateChanged: false,
		});
		expect(
			gradleVerificationOnly.tools.find((tool) => tool.toolId === "osv"),
		).toMatchObject({
			applicability: "applicable",
			coverageEffect: "partial",
		});

		const gradleLock = buildDiffScanPlan({
			resolved: resolved([
				entry("services/orders/gradle.lockfile"),
				entry("services/orders/build.gradle.kts"),
			]),
			tools,
		});
		expect(gradleLock.pluginContext).toMatchObject({
			dependencyStateChanged: true,
			lockStateChanged: true,
			limitationCodes: [],
		});
		expect(
			gradleLock.tools.find((tool) => tool.toolId === "osv"),
		).toMatchObject({
			applicability: "applicable",
			coverageEffect: "covered",
		});
	});

	it("distinguishes Python requirements and Go module companion changes", () => {
		const python = buildDiffScanPlan({
			resolved: resolved([entry("requirements-prod.txt")]),
			tools,
			projectInventoryPaths: ["requirements-prod.txt"],
		});
		expect(python.pluginContext).toMatchObject({
			dependencyStateChanged: true,
			lockStateChanged: true,
		});
		expect(python.pluginContext.limitationCodes).toEqual(
			expect.arrayContaining([
				"python_requirements_pinned_entries_only",
				"dependency_resolution_not_performed",
			]),
		);

		const goSum = buildDiffScanPlan({
			resolved: resolved([entry("go.sum")]),
			tools,
			projectInventoryPaths: ["go.mod", "go.sum"],
		});
		expect(goSum.pluginContext).toMatchObject({
			dependencyStateChanged: true,
			lockStateChanged: false,
		});
		expect(goSum.pluginContext.limitationCodes).toContain(
			"go_mod_declared_dependencies_only",
		);
	});

	it("separates detected plugins from path-affected plugins", () => {
		const plan = buildDiffScanPlan({
			resolved: resolved([entry("src/app.ts")]),
			tools,
			detectedPluginIds: ["language.java"],
		});

		expect(plan.pluginContext.detectedPluginIds).toEqual(["language.java"]);
		expect(plan.pluginContext.affectedPluginIds).toContain(
			"language.typescript",
		);
		expect(plan.pluginContext.affectedPluginIds).not.toContain("language.java");
	});

	it("uses the full project inventory when evaluating unchanged lock coverage", () => {
		const plan = buildDiffScanPlan({
			resolved: resolved([entry("package.json")]),
			tools,
			projectInventoryPaths: ["package.json", "package-lock.json"],
		});

		expect(plan.pluginContext).toMatchObject({
			dependencyStateChanged: true,
			lockStateChanged: false,
			limitationCodes: [],
		});
		expect(plan.tools.find((tool) => tool.toolId === "osv")).toMatchObject({
			applicability: "applicable",
			coverageEffect: "covered",
		});
	});

	it("distinguishes an empty diff from partial coverage", () => {
		const empty = buildDiffScanPlan({ resolved: resolved([]), tools });
		expect(
			empty.tools.every(
				(tool) =>
					tool.applicability === "not_applicable" &&
					tool.reasonCode === "no_changed_files" &&
					tool.coverageEffect === "covered",
			),
		).toBe(true);

		const partial = buildDiffScanPlan({
			resolved: resolved([
				{
					...entry("binary.bin"),
					binary: true,
					disposition: "unsupported",
					reasonCode: "binary_not_supported",
				},
			]),
			tools,
		});
		expect(
			partial.tools.every((tool) => tool.coverageEffect === "partial"),
		).toBe(true);
	});

	it("canonicalizes object key order recursively", () => {
		expect(
			canonicalJson({
				z: 1,
				a: { y: true, b: false },
			}),
		).toBe('{"a":{"b":false,"y":true},"z":1}');
	});

});

function resolved(
	entries: ResolvedGitDiff["entries"],
): ResolvedGitDiff {
	return {
		gitRoot: "/repo",
		projectRoot: "/repo",
		projectPrefix: "",
		requested: {
			kind: "working_tree",
			base: "HEAD",
			includeUntracked: true,
		},
		baseSha: "a".repeat(40),
		headSha: null,
		mergeBaseSha: null,
		includeUntracked: true,
		entries,
	};
}

function entry(path: string): ResolvedGitDiff["entries"][number] {
	return {
		status: "modified",
		path,
		contentSha256: "b".repeat(64),
		sizeBytes: 10,
		binary: false,
		inProfileScope: true,
		disposition: "scan",
		reasonCode: null,
	};
}
