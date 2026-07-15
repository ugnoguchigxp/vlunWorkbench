import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { executeStaticIntelligenceMcpTool } from "../../cli/static-intelligence-mcp-server";
import { staticIntelligenceMcpToolRegistry } from "./mcp-tools";

const EXPECTED_TOOL_NAMES = [
	"vuln_prepare_project_intelligence",
	"vuln_get_project_intelligence_status",
	"vuln_list_knowledge_sources",
	"vuln_get_knowledge_source_manifest",
	"vuln_get_guardrail_material",
	"vuln_get_evidence_bundle",
	"vuln_get_verification_commands",
	"vuln_get_code_structure_snapshot",
	"vuln_get_project_exploration_catalog",
] as const;

describe("Static Intelligence MCP server CLI", () => {
	it("lists registered tools without opening a database", () => {
		const result = runServerCli("--list-tools");

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = parseStdout(result.stdout);
		expect(payload).toMatchObject({ ok: true, status: "completed" });
		expect(toolNames(payload)).toEqual(EXPECTED_TOOL_NAMES);
		expect(
			(payload.tools as Array<{ inputSchema?: unknown }>).every((tool) =>
				Boolean(tool.inputSchema),
			),
		).toBe(true);
	});

	it("smoke-checks server construction and expected tool registration", () => {
		const result = runServerCli("--smoke");

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = parseStdout(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			status: "completed",
			serverName: "vuln-workbench-static-intelligence",
			connected: false,
		});
		expect(payload.tools).toEqual(EXPECTED_TOOL_NAMES);
	});

	it("returns JSON tool failure content when DB configuration is invalid", async () => {
		const tool = staticIntelligenceMcpToolRegistry.find(
			(candidate) => candidate.name === "vuln_list_knowledge_sources",
		);
		if (!tool) throw new Error("MCP list tool is missing.");

		const result = await executeStaticIntelligenceMcpTool(
			tool,
			{},
			{
				env: {
					DATABASE_URL: "postgres://localhost/vuln_workbench",
				},
			},
		);

		const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
		expect(payload).toMatchObject({
			ok: false,
			status: "failed",
		});
		expect(payload.message).toContain("DATABASE_URL must point to SQLite");
	});
});

function runServerCli(flag: "--list-tools" | "--smoke") {
	return spawnSync(process.execPath, [
		"api/cli/static-intelligence-mcp-server.ts",
		flag,
	], {
		cwd: process.cwd(),
		encoding: "utf8",
		env: {
			...process.env,
			DATABASE_URL: "file:/tmp/static-intelligence-mcp-cli-test.sqlite",
		},
	});
}

function parseStdout(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

function toolNames(payload: Record<string, unknown>): string[] {
	return (payload.tools as Array<{ name: string }>).map((tool) => tool.name);
}
