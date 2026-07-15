import { parseArgs } from "node:util";
import { ZodError } from "zod";
import {
	type ProjectExplorationCatalogInput,
	projectExplorationCatalogFailureSchema,
	projectExplorationCatalogInputSchema,
} from "../../shared/schemas/static-intelligence-exploration-catalog.schema";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { getProjectExplorationCatalogTool } from "../modules/static-intelligence/mcp-tools";

function writeJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main(): Promise<number> {
	let input: ProjectExplorationCatalogInput;
	try {
		input = parseInput();
	} catch (error) {
		writeJson(
			projectExplorationCatalogFailureSchema.parse({
				ok: false,
				status: "failed",
				reasonCode: inputFailureReason(error),
				message: message(error),
			}),
		);
		return 2;
	}

	let connection: ReturnType<typeof createDbConnection> | undefined;
	try {
		const env = readAppEnv();
		connection = createDbConnection(env.databaseUrl);
		const result = await getProjectExplorationCatalogTool({
			db: connection.db,
			input,
		});
		writeJson(result);
		if (result.ok) return 0;
		return result.reasonCode === "catalog_unavailable" ? 1 : 2;
	} catch (error) {
		writeJson(
			projectExplorationCatalogFailureSchema.parse({
				ok: false,
				status: "failed",
				reasonCode: "catalog_unavailable",
				message: message(error),
			}),
		);
		return 1;
	} finally {
		connection?.sqlite.close();
	}
}

function inputFailureReason(
	error: unknown,
): "focus_required" | "invalid_input" {
	return error instanceof ZodError &&
		error.issues.some((issue) => issue.message === "focus_required")
		? "focus_required"
		: "invalid_input";
}

function parseInput(): ProjectExplorationCatalogInput {
	const parsed = parseArgs({
		args: process.argv.slice(2),
		options: {
			"scan-run-id": { type: "string" },
			"generation-id": { type: "string" },
			path: { type: "string", multiple: true },
			"module-id": { type: "string", multiple: true },
			term: { type: "string", multiple: true },
			files: { type: "string" },
			tests: { type: "string" },
			"verification-commands": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	const limits = compact({
		files: parseOptionalInteger(parsed.values.files, "--files"),
		tests: parseOptionalInteger(parsed.values.tests, "--tests"),
		verificationCommands: parseOptionalInteger(
			parsed.values["verification-commands"],
			"--verification-commands",
		),
	});
	return projectExplorationCatalogInputSchema.parse({
		scanRunId: parsed.values["scan-run-id"],
		generationId: parsed.values["generation-id"],
		focus: compact({
			paths: parsed.values.path,
			moduleIds: parsed.values["module-id"],
			terms: parsed.values.term,
		}),
		...(Object.keys(limits).length > 0 ? { limits } : {}),
	});
}

function parseOptionalInteger(value: string | undefined, flag: string) {
	if (value === undefined) return undefined;
	if (!/^\d+$/.test(value)) throw new Error(`${flag} must be an integer.`);
	return Number.parseInt(value, 10);
}

function compact<T extends Record<string, unknown>>(value: T) {
	return Object.fromEntries(
		Object.entries(value).filter(([, item]) => item !== undefined),
	) as Partial<T>;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (import.meta.main) process.exitCode = await main();
