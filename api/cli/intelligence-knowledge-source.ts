import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { StaticIntelligenceGenerationRepository } from "../modules/static-intelligence/generation-repository";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "../modules/static-intelligence/knowledge-source-manifest";

type CliValues = Record<string, string | undefined>;

function writeResult(payload: Record<string, unknown>, pretty = false): void {
	console.log(JSON.stringify(payload, null, pretty ? 2 : undefined));
}

async function main(): Promise<number> {
	let argsValues: CliValues;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"scan-run-id": { type: "string" },
				"generation-id": { type: "string" },
				pretty: { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values as CliValues;
	} catch (error) {
		return fail(2, `Failed to parse arguments: ${message(error)}`);
	}

	let pretty = false;
	const scanRunId = argsValues["scan-run-id"];
	try {
		pretty = parseBoolean(argsValues.pretty, "--pretty") ?? false;
		if (!scanRunId) {
			return fail(2, "Missing required argument: --scan-run-id is required.");
		}
	} catch (error) {
		return fail(2, message(error), pretty);
	}

	let env: ReturnType<typeof readAppEnv>;
	try {
		env = readAppEnv();
	} catch (error) {
		return fail(1, message(error), pretty);
	}

	let dbConnection: ReturnType<typeof createDbConnection>;
	try {
		dbConnection = createDbConnection(env.databaseUrl);
	} catch (error) {
		return fail(1, message(error), pretty);
	}

	try {
		const repository = new StaticIntelligenceGenerationRepository(
			dbConnection.db,
		);
		const generation = argsValues["generation-id"]
			? await repository.loadGeneration(scanRunId, argsValues["generation-id"])
			: await repository.loadLatestValidGeneration(scanRunId);
		if (!generation)
			return fail(2, "Static Intelligence generation missing.", pretty);
		const manifest = buildStaticIntelligenceKnowledgeSourceManifest(
			generation.export.payload,
			{ generation },
		);
		writeResult(
			{
				ok: true,
				status: "completed",
				version: "v1",
				generatedAt: manifest.generatedAt,
				manifest,
			},
			pretty,
		);
		return 0;
	} catch (error) {
		return fail(
			message(error).includes("Generation") ? 2 : 1,
			message(error),
			pretty,
		);
	} finally {
		dbConnection.sqlite.close();
	}
}

function parseBoolean(
	value: string | undefined,
	flagName: string,
): boolean | undefined {
	if (value === undefined) return undefined;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${flagName} must be true or false.`);
}

function fail(exitCode: 1 | 2, messageText: string, pretty = false): number {
	writeResult(
		{
			ok: false,
			status: "failed",
			message: messageText,
		},
		pretty,
	);
	return exitCode;
}

function message(error: unknown): string {
	if (error instanceof ZodError)
		return error.issues.map((issue) => issue.message).join("; ");
	return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main();
