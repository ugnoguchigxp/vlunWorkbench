import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	analyzeProjectCapabilities,
	buildPluginExecutionSummary,
} from "./plugin-detector";
import {
	BUILT_IN_TECHNOLOGY_PLUGINS,
	builtInTechnologyPluginRegistry,
} from "../../plugins/builtin";
import { TechnologyPluginRegistry } from "./plugin-registry";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

describe("Python and Go built-in plugins", () => {
	it("registers the Phase 53 plugin set in deterministic order", () => {
		const ids = builtInTechnologyPluginRegistry.plugins().map((plugin) => plugin.manifest.id);
		const reversed = new TechnologyPluginRegistry([...BUILT_IN_TECHNOLOGY_PLUGINS].reverse());
		expect(reversed.plugins().map((plugin) => plugin.manifest.id)).toEqual(ids);
		expect(reversed.registryDigest).toBe(builtInTechnologyPluginRegistry.registryDigest);
		expect(ids).toEqual(
			expect.arrayContaining([
				"language.python",
				"build.python-requirements",
				"framework.python.fastapi",
				"framework.python.flask",
				"framework.python.django",
				"language.go",
				"build.go-modules",
				"framework.go.net-http",
				"framework.go.gin",
				"framework.go.echo",
			]),
		);
	});

	it("detects a polyglot FastAPI and Gin project without overstating partial coverage", async () => {
		const root = await fixture({
			"app.py":
				'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/health")\ndef health(): return {"ok": True}\n',
			"requirements.txt": "fastapi==0.116.1\nuvicorn==0.35.0\n",
			"go.mod":
				"module example.com/polyglot\n\ngo 1.24\n\nrequire github.com/gin-gonic/gin v1.10.1\n",
			"main.go":
				'package main\nimport "github.com/gin-gonic/gin"\nfunc main(){ r := gin.Default(); r.GET("/go", h) }\n',
		});

		const analysis = await analyzeProjectCapabilities(root);
		expect(analysis.capabilityPlan.activePluginIds).toEqual(
			expect.arrayContaining([
				"language.python",
				"build.python-requirements",
				"framework.python.fastapi",
				"language.go",
				"build.go-modules",
				"framework.go.gin",
			]),
		);
		expect(analysis.capabilityPlan.steps.find((step) => step.stepId === "project_structure")).toMatchObject({
			coverageEffect: "partial",
		});
		expect(analysis.capabilityPlan.steps.find((step) => step.stepId === "endpoint_extraction")).toMatchObject({
			coverageEffect: "partial",
		});
		expect(analysis.capabilityPlan.steps.find((step) => step.stepId === "dast_start")).toMatchObject({
			coverageEffect: "gap",
			reasonCode: "project_code_execution_sandbox_required",
		});
		const execution = buildPluginExecutionSummary({
			detections: analysis.detections,
			capabilityPlan: analysis.capabilityPlan,
			stepResults: [
				{ kind: "static_tool", toolId: "osv", status: "completed", coverageEffect: "covered" },
			],
		});
		expect(
			execution.pluginResults.find(
				(result) => result.pluginId === "build.python-requirements",
			),
		).toMatchObject({ coverageEffect: "partial" });
		expect(
			execution.pluginResults.find((result) => result.pluginId === "build.go-modules"),
		).toMatchObject({ coverageEffect: "partial" });
	});

	it("does not activate web framework plugins from unrelated method names", async () => {
		const root = await fixture({
			"tool.py": [
				"class Router:",
				"    def get(self, value): return value",
				'example = \"\"\"from fastapi import FastAPI',
				"app = FastAPI()\"\"\"",
			].join("\n"),
			"main.go": [
				"package main",
				"type Router struct{}",
				"func (Router) Get(value string) {}",
				"var example = `",
				'import "github.com/gin-gonic/gin"',
				"r.GET(\"/pseudo\", h)",
				"`",
			].join("\n"),
		});
		const analysis = await analyzeProjectCapabilities(root);
		const active = analysis.capabilityPlan.activePluginIds;
		expect(active).toEqual(expect.arrayContaining(["language.python", "language.go"]));
		expect(active.some((pluginId) => pluginId.startsWith("framework.python."))).toBe(false);
		expect(active.some((pluginId) => pluginId.startsWith("framework.go."))).toBe(false);
	});

	it("does not activate FastAPI from prose in pyproject metadata", async () => {
		const root = await fixture({
			"tool.py": "def run(): return True\n",
			"pyproject.toml": [
				"[project]",
				'name = "example"',
				'description = """',
				"Use framework examples in the documentation.",
				'fastapi = "not a dependency"',
				'"""',
			].join("\n"),
		});

		const analysis = await analyzeProjectCapabilities(root);
		expect(analysis.capabilityPlan.activePluginIds).not.toContain(
			"framework.python.fastapi",
		);
	});

	it("detects a declared FastAPI dependency in pyproject metadata", async () => {
		const root = await fixture({
			"tool.py": "def run(): return True\n",
			"pyproject.toml": [
				"[project]",
				'name = "example"',
				'dependencies = ["fastapi>=0.116"]',
			].join("\n"),
		});

		const analysis = await analyzeProjectCapabilities(root);
		expect(analysis.capabilityPlan.activePluginIds).toContain(
			"framework.python.fastapi",
		);
	});

	it("surfaces Go module and workspace resolution limitations", async () => {
		const root = await fixture({
			"go.mod": [
				"module example.com/service",
				"require corp.invalid/lib latest",
				"replace corp.invalid/lib => ../lib",
			].join("\n"),
			"go.work": "go 1.24\nuse .\n",
			"main.go": "package main\nfunc main() {}\n",
		});

		const analysis = await analyzeProjectCapabilities(root);
		const detection = analysis.detections.find(
			(item) => item.pluginId === "build.go-modules",
		);
		expect(detection?.limitations).toEqual(
			expect.arrayContaining([
				"go_mod_require_unparsed",
				"go_mod_replace_resolution_not_performed",
				"go_workspace_resolution_partial",
			]),
		);
		expect(
			analysis.capabilityPlan.steps.find(
				(step) => step.stepId === "dependency:dependency.go-modules",
			)?.limitationCodes,
		).toContain("go_workspace_resolution_partial");
	});

	it("marks multiple Python framework start candidates as ambiguous", async () => {
		const root = await fixture({
			"app.py": [
				"from fastapi import FastAPI",
				"from flask import Flask",
				"api = FastAPI()",
				"web = Flask(__name__)",
			].join("\n"),
		});

		const analysis = await analyzeProjectCapabilities(root);
		expect(
			analysis.capabilityPlan.steps.find((step) => step.stepId === "dast_start"),
		).toMatchObject({
			applicability: "not_applicable",
			reasonCode: "target_start_not_supported",
			coverageEffect: "gap",
			limitationCodes: ["target_start_ambiguous"],
		});
	});

	it("does not produce a Python start plan when the application symbol is ambiguous", async () => {
		const root = await fixture({
			"first.py": "from fastapi import FastAPI\nfirst = FastAPI()\n",
			"second.py": "from fastapi import FastAPI\nsecond = FastAPI()\n",
			"requirements.txt": "fastapi==0.116.1\n",
		});
		const analysis = await analyzeProjectCapabilities(root);
		expect(analysis.capabilityPlan.activePluginIds).toContain(
			"framework.python.fastapi",
		);
		expect(
			analysis.capabilityPlan.steps.find((step) => step.stepId === "dast_start"),
		).toMatchObject({
			applicability: "not_applicable",
			reasonCode: "target_start_not_supported",
			coverageEffect: "gap",
		});
	});
});

async function fixture(files: Record<string, string>): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-plugin-phase53-"));
	temporaryRoots.push(root);
	for (const [relativePath, content] of Object.entries(files)) {
		const absolutePath = path.join(root, relativePath);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, content);
	}
	return root;
}
