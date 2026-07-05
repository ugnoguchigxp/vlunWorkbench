import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { indexStaticIntelligenceEmbeddings } from "../modules/static-intelligence/embedding-indexer";
import { StaticIntelligenceEmbeddingRepository } from "../modules/static-intelligence/embedding-repository";
import { createAzureOpenAiProviderFromAppEnv } from "../providers/azureOpenAiProviderFactory";
import type { EmbeddingProvider } from "../providers/types";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function parseBoolean(
	value: string | undefined,
	defaultValue: boolean,
): boolean {
	if (value === undefined) return defaultValue;
	return value === "true";
}

function parseOptionalLimit(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error("--limit must be a positive integer.");
	}
	return parsed;
}

async function main(): Promise<number> {
	let argsValues: Record<string, string | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"scan-run-id": { type: "string" },
				force: { type: "string" },
				limit: { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values as Record<string, string | undefined>;
	} catch (error) {
		return fail(2, `Failed to parse arguments: ${errorMessage(error)}`);
	}

	const scanRunId = argsValues["scan-run-id"];
	if (!scanRunId) {
		return fail(2, "Missing required argument: --scan-run-id is required.");
	}
	if (
		argsValues.force !== undefined &&
		argsValues.force !== "true" &&
		argsValues.force !== "false"
	) {
		return fail(2, "--force must be true or false.");
	}

	let limit: number | undefined;
	try {
		limit = parseOptionalLimit(argsValues.limit);
	} catch (error) {
		return fail(2, errorMessage(error));
	}

	let env: ReturnType<typeof readAppEnv>;
	try {
		env = readAppEnv();
	} catch (error) {
		return fail(2, errorMessage(error));
	}

	let dbConnection: ReturnType<typeof createDbConnection>;
	try {
		dbConnection = createDbConnection(env.databaseUrl);
	} catch (error) {
		return fail(1, errorMessage(error));
	}

	try {
		const embeddingRepository = new StaticIntelligenceEmbeddingRepository(
			dbConnection.db,
		);
		const scanRunExists = await embeddingRepository.scanRunExists(scanRunId);
		if (!scanRunExists) {
			return fail(2, `Scan run not found: ${scanRunId}`);
		}

		let embeddingProvider: EmbeddingProvider;
		try {
			embeddingProvider = createAzureOpenAiProviderFromAppEnv(env);
		} catch (error) {
			return fail(2, errorMessage(error));
		}

		const result = await indexStaticIntelligenceEmbeddings({
			db: dbConnection.db,
			scanRunId,
			embeddingProvider,
			options: {
				force: parseBoolean(argsValues.force, false),
				limit,
				embeddingModel: env.azureOpenAiEmbeddingsDeployment,
			},
		});
		writeResult(result);
		return 0;
	} catch (error) {
		const message = errorMessage(error);
		const exitCode = message.startsWith("Scan run not found:") ? 2 : 1;
		return fail(exitCode, message);
	} finally {
		dbConnection.sqlite.close();
	}
}

function fail(exitCode: 1 | 2, message: string): number {
	writeResult({
		ok: false,
		status: "failed",
		message,
	});
	return exitCode;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main();
