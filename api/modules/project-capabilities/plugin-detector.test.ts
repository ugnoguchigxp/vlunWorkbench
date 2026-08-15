import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { TechnologyPluginV1 } from "./plugin-contract";
import {
	analyzeProjectCapabilities,
	buildPluginExecutionSummary,
	DEFAULT_PLUGIN_LIMITS,
	detectProjectPlugins,
} from "./plugin-detector";
import { TechnologyPluginRegistry } from "./plugin-registry";

describe("project technology plugin detector", () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-plugin-detector-"));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	it("detects TypeScript, npm, and an installed framework", async () => {
		await write(
			"package.json",
			JSON.stringify({
				scripts: { dev: "vite" },
				dependencies: { hono: "4.0.0" },
			}),
		);
		await write("package-lock.json", "{}");
		await write("src/app.ts", 'import { Hono } from "hono";');

		const analysis = await analyzeProjectCapabilities(root);

		expect(analysis.capabilityPlan.activePluginIds).toEqual(
			expect.arrayContaining([
				"language.typescript",
				"build.npm",
				"framework.typescript.hono",
			]),
		);
		expect(
			analysis.capabilityPlan.steps.find(
				(step) => step.stepId === "dependency:dependency.npm",
			),
		).toMatchObject({ coverageEffect: "covered", reasonCode: null });
	});

	it("detects Java, Maven, and Spring without overstating dependency coverage", async () => {
		await write(
			"pom.xml",
			`<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>`,
		);
		await write(
			"src/main/java/example/Controller.java",
			'package example; @RestController class Controller { @GetMapping("/health") void health() {} }',
		);

		const analysis = await analyzeProjectCapabilities(root);

		expect(analysis.capabilityPlan.activePluginIds).toEqual(
			expect.arrayContaining([
				"language.java",
				"build.maven",
				"framework.java.spring",
			]),
		);
		expect(
			analysis.capabilityPlan.steps.find(
				(step) => step.stepId === "dependency:dependency.maven",
			),
		).toMatchObject({
			coverageEffect: "partial",
			reasonCode: "maven_direct_dependencies_only",
		});
		expect(
			analysis.capabilityPlan.steps.find(
				(step) => step.stepId === "dast_start",
			),
		).toMatchObject({
			applicability: "applicable",
			coverageEffect: "gap",
			reasonCode: "project_code_execution_sandbox_required",
		});
	});

	it("records a Gradle lock gap instead of treating build files as clean", async () => {
		await write(
			"build.gradle",
			`plugins { id 'org.springframework.boot' version '3.4.0' }`,
		);
		await write(
			"src/main/java/example/App.java",
			"package example; class App {}",
		);

		const analysis = await analyzeProjectCapabilities(root);
		const dependencyStep = analysis.capabilityPlan.steps.find(
			(step) => step.stepId === "dependency:dependency.gradle",
		);

		expect(analysis.capabilityPlan.activePluginIds).toContain("build.gradle");
		expect(dependencyStep).toMatchObject({
			coverageEffect: "gap",
			reasonCode: "gradle_dependency_lock_missing",
		});
	});

	it("does not activate Spring from a lone annotation", async () => {
		await write(
			"src/main/java/example/Controller.java",
			'@RestController class Controller { @GetMapping("/health") void health() {} }',
		);

		const analysis = await analyzeProjectCapabilities(root);

		expect(analysis.capabilityPlan.activePluginIds).toContain("language.java");
		expect(analysis.capabilityPlan.activePluginIds).not.toContain(
			"framework.java.spring",
		);
	});

	it("runs detectors sequentially against the shared read budget", async () => {
		let firstCompleted = false;
		const fixture = fixturePlugin("language.fixture");
		fixture.detectors = [
			{
				id: "detect.fixture.first",
				pluginId: fixture.manifest.id,
				fileGlobs: [],
				async detect() {
					await Promise.resolve();
					firstCompleted = true;
					return noDetection();
				},
			},
			{
				id: "detect.fixture.second",
				pluginId: fixture.manifest.id,
				fileGlobs: [],
				detect() {
					return {
						...noDetection(),
						detected: firstCompleted,
					};
				},
			},
		];
		const registry = new TechnologyPluginRegistry([fixture]);

		const detections = await detectProjectPlugins(
			{
				inventory: [],
				limits: { ...DEFAULT_PLUGIN_LIMITS },
				readText: async () => ({ ok: false, reason: "not_found" }),
			},
			registry,
		);

		expect(detections[0]?.detected).toBe(true);
	});

	it("rejects a file that grows beyond the per-file read limit after inventory", async () => {
		await write("fixture.txt", "small");
		let readReason: string | undefined;
		const fixture = fixturePlugin("language.fixture");
		fixture.detectors = [
			{
				id: "detect.fixture.bounded-read",
				pluginId: fixture.manifest.id,
				fileGlobs: ["fixture.txt"],
				async detect(context) {
					await fs.writeFile(
						path.join(root, "fixture.txt"),
						Buffer.alloc(DEFAULT_PLUGIN_LIMITS.maxFileBytes + 1),
					);
					const result = await context.readText("fixture.txt");
					if (!result.ok) readReason = result.reason;
					return noDetection();
				},
			},
		];

		await analyzeProjectCapabilities(
			root,
			new TechnologyPluginRegistry([fixture]),
		);

		expect(readReason).toBe("file_too_large");
	});

	it("keeps skipped executions skipped in plugin summaries", async () => {
		await write(
			"package.json",
			JSON.stringify({ scripts: { start: "node server.js" } }),
		);
		await write("src/app.ts", "export const app = true;");
		const analysis = await analyzeProjectCapabilities(root);

		const summary = buildPluginExecutionSummary({
			detections: analysis.detections,
			capabilityPlan: analysis.capabilityPlan,
			stepResults: [{ kind: "dast", status: "skipped" }],
		});

		expect(
			summary.pluginResults
				.filter((result) => result.capability === "dast_start")
				.every((result) => result.status === "skipped"),
		).toBe(true);
	});

	it("downgrades failed executions to a coverage gap", async () => {
		await write("src/app.ts", "export const app = true;");
		const analysis = await analyzeProjectCapabilities(root);

		const summary = buildPluginExecutionSummary({
			detections: analysis.detections,
			capabilityPlan: analysis.capabilityPlan,
			stepResults: [
				{
					kind: "static_tool",
					toolId: "semgrep",
					status: "failed",
					reasonCode: "scanner_execution_failed",
				},
			],
		});

		expect(
			summary.pluginResults.find(
				(result) =>
					result.pluginId === "language.typescript" &&
					result.capability === "semgrep",
			),
		).toMatchObject({
			status: "failed",
			coverageEffect: "gap",
			limitationCodes: ["scanner_execution_failed"],
		});
	});

	it("reports an applicable scanner capability omitted by a profile as a gap", async () => {
		await write("src/app.ts", "export const app = true;");
		const analysis = await analyzeProjectCapabilities(root);

		const summary = buildPluginExecutionSummary({
			detections: analysis.detections,
			capabilityPlan: analysis.capabilityPlan,
			stepResults: [],
		});

		expect(
			summary.pluginResults.find(
				(result) =>
					result.pluginId === "language.typescript" &&
					result.capability === "semgrep",
			),
		).toMatchObject({
			status: "skipped",
			coverageEffect: "gap",
			limitationCodes: ["capability_step_not_executed"],
		});
	});

	async function write(relativePath: string, content: string): Promise<void> {
		const filePath = path.join(root, relativePath);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, content);
	}
});

function fixturePlugin(id: string): TechnologyPluginV1 {
	return {
		manifest: {
			schemaVersion: 1,
			pluginApiVersion: "1",
			id,
			version: "1.0.0",
			kind: "language",
			displayName: id,
			requires: { allOf: [], oneOf: [] },
			declaredCapabilities: ["source_detection"],
		},
		detectors: [],
		dependencyProviders: [],
		sourceAnalyzers: [],
		endpointExtractors: [],
		semgrepRules: [],
		startPlanners: [],
	};
}

function noDetection() {
	return {
		detected: false,
		confidence: "low" as const,
		evidence: [],
		limitations: [],
	};
}
