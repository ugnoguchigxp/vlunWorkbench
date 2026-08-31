import { spawn } from "node:child_process";
import { readAppEnv } from "../../app/env";
import { createDbConnection, type DbConnection } from "../../db";
import { staticIntelligenceMcpToolFailureSchema } from "./mcp-tool-schemas";
import type {
	StaticIntelligenceMcpToolDefinition,
	StaticIntelligenceMcpToolResult,
} from "./mcp-tools";

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
			allowedProjectRoots: env.staticIntelligenceAllowedProjectRoots ?? [],
			projectCreationPolicy:
				env.staticIntelligenceProjectCreationPolicy ?? "registered_only",
		});
		if (!tool.readOnlyHint) launchPrepareWorker(result, options.env);
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

function launchPrepareWorker(
	result: StaticIntelligenceMcpToolResult,
	envOverrides?: NodeJS.ProcessEnv,
): void {
	if (
		!result ||
		typeof result !== "object" ||
		(result.status !== "queued" && result.status !== "running")
	)
		return;
	const provenance = result.provenance;
	if (!provenance || typeof provenance !== "object") return;
	const jobId = (provenance as { prepareJobId?: unknown }).prepareJobId;
	if (typeof jobId !== "string" || !jobId) return;
	const child = spawn(
		process.execPath,
		["api/cli/static-intelligence-prepare-worker.ts", "--job-id", jobId],
		{
			cwd: process.cwd(),
			detached: true,
			stdio: "ignore",
			env: { ...process.env, ...envOverrides },
		},
	);
	child.unref();
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

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
