import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

it("lists Static Intelligence tools through a real MCP stdio connection", async () => {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-stdio-smoke-"));
	const transport = new StdioClientTransport({
		command: "bun",
		args: ["run", "api/cli/static-intelligence-mcp-server.ts"],
		cwd: process.cwd(),
		env: {
			...getDefaultEnvironment(),
			DATABASE_URL: `file:${path.join(tempDir, "mcp.sqlite")}`,
			SCAN_ARTIFACT_ROOT: path.join(tempDir, "artifacts"),
		},
		stderr: "pipe",
	});
	const client = new Client(
		{ name: "static-intelligence-stdio-smoke", version: "1.0.0" },
		{ capabilities: {} },
	);
	try {
		await client.connect(transport);
		const listed = await client.listTools();
		expect(
			listed.tools.find(
				(tool) => tool.name === "vuln_get_project_exploration_catalog",
			),
		).toMatchObject({
			name: "vuln_get_project_exploration_catalog",
			annotations: { readOnlyHint: true },
		});
	} finally {
		await client.close();
		await fs.rm(tempDir, { recursive: true, force: true });
	}
});
