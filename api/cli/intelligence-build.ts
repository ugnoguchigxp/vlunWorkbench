import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	buildStaticIntelligenceGeneration,
	StaticIntelligenceBuildInputError,
} from "../modules/static-intelligence/build-service";
import { indexStaticIntelligenceEmbeddings } from "../modules/static-intelligence/embedding-indexer";
import { createAzureOpenAiProviderFromAppEnv } from "../providers/azureOpenAiProviderFactory";

type CliValues = Record<string, string | undefined>;

function writeResult(payload: Record<string, unknown>, pretty = false): void {
	process.stdout.write(
		`${JSON.stringify(payload, null, pretty ? 2 : undefined)}\n`,
	);
}

async function main(): Promise<number> {
	let values: CliValues;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"scan-run-id": { type: "string" },
				"max-files": { type: "string" },
				"include-semantic": { type: "string" },
				pretty: { type: "string" },
			},
			strict: true,
		});
		values = parsed.values as CliValues;
	} catch (error) {
		return fail(2, `Failed to parse arguments: ${message(error)}`);
	}

	let options: {
		scanRunId: string;
		maxFiles?: number;
		includeSemantic: boolean;
		pretty: boolean;
	};
	try {
		const scanRunId = values["scan-run-id"];
		if (!scanRunId) {
			throw new Error("Missing required argument: --scan-run-id is required.");
		}
		options = {
			scanRunId,
			maxFiles: parseMaxFiles(values["max-files"]),
			includeSemantic:
				parseBoolean(values["include-semantic"], "--include-semantic") ?? false,
			pretty: parseBoolean(values.pretty, "--pretty") ?? false,
		};
	} catch (error) {
		return fail(2, message(error));
	}

	let env: ReturnType<typeof readAppEnv>;
	try {
		env = readAppEnv();
	} catch (error) {
		return fail(1, message(error), options.pretty);
	}

	let dbConnection: ReturnType<typeof createDbConnection>;
	try {
		dbConnection = createDbConnection(env.databaseUrl);
	} catch (error) {
		return fail(1, message(error), options.pretty);
	}

	try {
		const semanticIndexer = createSemanticIndexer({
			includeSemantic: options.includeSemantic,
			db: dbConnection.db,
			env,
		});
		const result = await buildStaticIntelligenceGeneration({
			db: dbConnection.db,
			scanRunId: options.scanRunId,
			maxFiles: options.maxFiles,
			includeSemantic: options.includeSemantic,
			semanticIndexer,
		});
		writeResult(result, options.pretty);
		return 0;
	} catch (error) {
		return fail(
			error instanceof StaticIntelligenceBuildInputError ? 2 : 1,
			message(error),
			options.pretty,
		);
	} finally {
		dbConnection.sqlite.close();
	}
}

function createSemanticIndexer(params: {
	includeSemantic: boolean;
	db: ReturnType<typeof createDbConnection>["db"];
	env: ReturnType<typeof readAppEnv>;
}): ((scanRunId: string) => Promise<void>) | undefined {
	if (!params.includeSemantic) return undefined;
	try {
		const embeddingProvider = createAzureOpenAiProviderFromAppEnv(params.env);
		return async (scanRunId) => {
			await indexStaticIntelligenceEmbeddings({
				db: params.db,
				scanRunId,
				embeddingProvider,
				options: {
					embeddingModel: params.env.azureOpenAiEmbeddingsDeployment,
				},
			});
		};
	} catch {
		return undefined;
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

function parseMaxFiles(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const numeric = Number(value);
	if (!Number.isInteger(numeric) || numeric < 1 || numeric > 20000) {
		throw new Error("--max-files must be an integer between 1 and 20000.");
	}
	return numeric;
}

function fail(exitCode: 1 | 2, errorMessage: string, pretty = false): number {
	writeResult(
		{
			ok: false,
			status: "failed",
			message: errorMessage,
		},
		pretty,
	);
	return exitCode;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main();
