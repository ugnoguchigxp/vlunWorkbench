import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { executeStaticIntelligenceMcpTool } from "../modules/static-intelligence/mcp-server-runtime";
import { staticIntelligenceMcpToolRegistry } from "../modules/static-intelligence/mcp-tools";

const EXPECTED_TOOL_NAMES = [
	"vuln_prepare_project_intelligence",
	"vuln_get_project_intelligence_status",
	"vuln_list_knowledge_sources",
	"vuln_get_knowledge_source_manifest",
	"vuln_get_guardrail_material",
	"vuln_get_evidence_bundle",
	"vuln_get_verification_commands",
	"vuln_get_project_structure_snapshot",
	"vuln_get_project_exploration_catalog",
] as const;

type CliMode = "normal" | "help" | "list-tools" | "smoke";

function writeJson(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function writeHelp(): void {
	console.log(`Usage: bun run mcp:static-intelligence [--help|--list-tools|--smoke]

Runs the Static Intelligence MCP stdio server. Query tools are read-only; the
explicit prepare action queues persisted background work.

Options:
  --help        Print this usage and exit.
  --list-tools  Print registered tool metadata as JSON and exit without opening DB.
  --smoke       Validate server construction and expected tool registration as JSON.`);
}

function parseMode(): CliMode {
	const parsed = parseArgs({
		args: process.argv.slice(2),
		options: {
			help: { type: "boolean" },
			"list-tools": { type: "boolean" },
			smoke: { type: "boolean" },
		},
		strict: true,
		allowPositionals: false,
	});
	if (parsed.values.help) return "help";
	if (parsed.values["list-tools"]) return "list-tools";
	if (parsed.values.smoke) return "smoke";
	return "normal";
}

export function createStaticIntelligenceMcpServer(): McpServer {
	const server = new McpServer({
		name: "vuln-workbench-static-intelligence",
		version: "1.0.0",
	});

	for (const tool of staticIntelligenceMcpToolRegistry) {
		server.registerTool(
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.inputSchema,
				annotations: {
					readOnlyHint: tool.readOnlyHint,
					destructiveHint: tool.destructiveHint ?? false,
					idempotentHint: tool.idempotentHint ?? true,
				},
			},
			async (input) => executeStaticIntelligenceMcpTool(tool, input),
		);
	}

	return server;
}

function launchRecoveryWorker(): void {
	const child = spawn(
		process.execPath,
		["api/cli/static-intelligence-prepare-worker.ts", "--recover"],
		{
			cwd: process.cwd(),
			detached: true,
			stdio: "ignore",
			env: process.env,
		},
	);
	child.unref();
}

function listToolsPayload() {
	return {
		ok: true,
		status: "completed",
		tools: staticIntelligenceMcpToolRegistry.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: z.toJSONSchema(tool.inputSchema),
			annotations: {
				readOnlyHint: tool.readOnlyHint,
				destructiveHint: tool.destructiveHint ?? false,
				idempotentHint: tool.idempotentHint ?? true,
			},
		})),
	};
}

function smokePayload() {
	const server = createStaticIntelligenceMcpServer();
	const registeredNames = staticIntelligenceMcpToolRegistry.map(
		(tool) => tool.name,
	);
	const missing = EXPECTED_TOOL_NAMES.filter(
		(toolName) => !registeredNames.includes(toolName),
	);
	return {
		ok: missing.length === 0,
		status: missing.length === 0 ? "completed" : "failed",
		serverName: "vuln-workbench-static-intelligence",
		toolCount: registeredNames.length,
		tools: registeredNames,
		missing,
		connected: server.isConnected(),
	};
}

async function main(): Promise<number> {
	let mode: CliMode;
	try {
		mode = parseMode();
	} catch (error) {
		console.error(message(error));
		return 2;
	}

	if (mode === "help") {
		writeHelp();
		return 0;
	}
	if (mode === "list-tools") {
		writeJson(listToolsPayload());
		return 0;
	}
	if (mode === "smoke") {
		const payload = smokePayload();
		writeJson(payload);
		return payload.ok ? 0 : 1;
	}

	try {
		launchRecoveryWorker();
		const server = createStaticIntelligenceMcpServer();
		const transport = new StdioServerTransport();
		await server.connect(transport);
		return 0;
	} catch (error) {
		console.error(message(error));
		return 1;
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) {
	process.exitCode = await main();
}
