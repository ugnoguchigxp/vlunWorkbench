import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	parseSourceKindsCsv,
	StaticIntelligenceEmbeddingRepository,
	type StaticIntelligenceEmbeddingFilters,
} from "../modules/static-intelligence/embedding-repository";
import { runStaticIntelligenceSemanticQuery } from "../modules/static-intelligence/semantic-query";
import { createAzureOpenAiProviderFromAppEnv } from "../providers/azureOpenAiProviderFactory";
import type { EmbeddingProvider } from "../providers/types";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function parseTopK(value: string | undefined): number {
	if (value === undefined) return 10;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error("--top-k must be a positive integer.");
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
				query: { type: "string" },
				"top-k": { type: "string" },
				"source-kind": { type: "string" },
				file: { type: "string" },
				"rule-id": { type: "string" },
				scanner: { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values as Record<string, string | undefined>;
	} catch (error) {
		return fail(2, `Failed to parse arguments: ${errorMessage(error)}`);
	}

	const scanRunId = argsValues["scan-run-id"];
	const query = argsValues.query?.trim();
	if (!scanRunId) {
		return fail(2, "Missing required argument: --scan-run-id is required.");
	}
	if (!query) {
		return fail(2, "Missing required argument: --query is required.");
	}

	let topK: number;
	let filters: StaticIntelligenceEmbeddingFilters;
	try {
		topK = parseTopK(argsValues["top-k"]);
		filters = {
			sourceKinds: parseSourceKindsCsv(argsValues["source-kind"]),
			file: argsValues.file,
			ruleId: argsValues["rule-id"],
			scanner: argsValues.scanner,
		};
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
		const repository = new StaticIntelligenceEmbeddingRepository(
			dbConnection.db,
		);
		const scanRunExists = await repository.scanRunExists(scanRunId);
		if (!scanRunExists) {
			return fail(2, `Scan run not found: ${scanRunId}`);
		}
		const indexedCount = await repository.countIndexedRows(scanRunId, filters);
		let embeddingProvider: EmbeddingProvider | undefined;
		if (indexedCount > 0) {
			try {
				embeddingProvider = createAzureOpenAiProviderFromAppEnv(env);
			} catch (error) {
				return fail(2, errorMessage(error));
			}
		}
		const result = await runStaticIntelligenceSemanticQuery({
			db: dbConnection.db,
			scanRunId,
			query,
			embeddingProvider,
			options: { topK, filters },
		});
		writeResult(result);
		return 0;
	} catch (error) {
		return fail(1, errorMessage(error));
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
