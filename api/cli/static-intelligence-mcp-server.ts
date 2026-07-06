import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readAppEnv } from "../app/env";
import { createDbConnection, type DbConnection } from "../db";
import {
	type StaticIntelligenceMcpToolDefinition,
	staticIntelligenceMcpToolRegistry,
} from "../modules/static-intelligence/mcp-tools";
import { staticIntelligenceMcpToolFailureSchema } from "../modules/static-intelligence/mcp-tool-schemas";

const EXPECTED_TOOL_NAMES = [
	"vuln_list_knowledge_sources",
	"vuln_get_knowledge_source_manifest",
	"vuln_get_guardrail_material",
	"vuln_get_evidence_bundle",
	"vuln_get_verification_commands",
] as const;

type CliMode = "normal" | "help" | "list-tools" | "smoke";

function writeJson(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function writeHelp(): void {
	console.log(`Usage: bun run mcp:static-intelligence [--help|--list-tools|--smoke]

Runs the read-only Static Intelligence MCP stdio server.

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
				annotations: { readOnlyHint: true },
			},
			async (input) => executeStaticIntelligenceMcpTool(tool, input),
		);
	}

	return server;
}

export async function executeStaticIntelligenceMcpTool(
	tool: StaticIntelligenceMcpToolDefinition,
	input: unknown,
	options: { env?: NodeJS.ProcessEnv } = {},
) {
	let dbConnection: DbConnection | undefined;
	try {
		const env = readAppEnv(options.env);
		dbConnection = createDbConnection(env.databaseUrl);
		const result = await tool.handler({
			db: dbConnection.db,
			input,
		});
		return jsonToolContent(result);
	} catch (error) {
		return jsonToolContent(
			staticIntelligenceMcpToolFailureSchema.parse({
				ok: false,
				status: "failed",
				message: message(error),
			}),
		);
	} finally {
		dbConnection?.sqlite.close();
	}
}

function jsonToolContent(payload: unknown) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(payload),
			},
		],
	};
}

function listToolsPayload() {
	return {
		ok: true,
		status: "completed",
		tools: staticIntelligenceMcpToolRegistry.map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: z.toJSONSchema(tool.inputSchema),
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
