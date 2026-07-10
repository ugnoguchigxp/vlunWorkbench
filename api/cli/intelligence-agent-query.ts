import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	StaticIntelligenceAgentQueryInvalidRequestError,
	runStaticIntelligenceAgentQuery,
} from "../modules/static-intelligence/agent-query";
import { StaticIntelligenceScanRunNotFoundError } from "../modules/static-intelligence/export-builder";
import { StaticIntelligenceEmbeddingRepository } from "../modules/static-intelligence/embedding-repository";
import {
	StaticIntelligenceGenerationRepository,
	StaticIntelligenceGenerationValidationError,
} from "../modules/static-intelligence/generation-repository";
import { createAzureOpenAiProviderFromAppEnv } from "../providers/azureOpenAiProviderFactory";
import type { EmbeddingProvider } from "../providers/types";
import { staticIntelligenceAgentQueryInputSchema } from "../../shared/schemas/static-intelligence-agent-query.schema";

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
				kind: { type: "string" },
				query: { type: "string" },
				"finding-id": { type: "string" },
				file: { type: "string" },
				"rule-id": { type: "string" },
				scanner: { type: "string" },
				"include-semantic": { type: "string" },
				"include-communities": { type: "string" },
				"include-landscape": { type: "string" },
				"include-markdown": { type: "string" },
				"top-k": { type: "string" },
				pretty: { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values as CliValues;
	} catch (error) {
		return fail(2, `Failed to parse arguments: ${message(error)}`);
	}

	let pretty = false;
	let input: Parameters<typeof runStaticIntelligenceAgentQuery>[0]["input"];
	try {
		pretty = parseBoolean(argsValues.pretty, "--pretty") ?? false;
		const scanRunId = argsValues["scan-run-id"];
		const queryKind = argsValues.kind;
		if (!scanRunId) {
			return fail(2, "Missing required argument: --scan-run-id is required.");
		}
		if (!queryKind) {
			return fail(2, "Missing required argument: --kind is required.");
		}
		input = staticIntelligenceAgentQueryInputSchema.parse({
			scanRunId,
			queryKind,
			query: argsValues.query,
			findingId: argsValues["finding-id"],
			file: argsValues.file,
			ruleId: argsValues["rule-id"],
			scanner: argsValues.scanner,
			includeSemantic: parseBoolean(
				argsValues["include-semantic"],
				"--include-semantic",
			),
			includeCommunities: parseBoolean(
				argsValues["include-communities"],
				"--include-communities",
			),
			includeLandscape: parseBoolean(
				argsValues["include-landscape"],
				"--include-landscape",
			),
			includeMarkdown: parseBoolean(
				argsValues["include-markdown"],
				"--include-markdown",
			),
			topK: parseTopK(argsValues["top-k"]),
		});
	} catch (error) {
		return fail(2, message(error), pretty);
	}

	let env: ReturnType<typeof readAppEnv>;
	try {
		env = readAppEnv();
	} catch (error) {
		return fail(2, message(error), pretty);
	}

	let dbConnection: ReturnType<typeof createDbConnection>;
	try {
		dbConnection = createDbConnection(env.databaseUrl);
	} catch (error) {
		return fail(1, message(error), pretty);
	}

	try {
		const generationRepository = new StaticIntelligenceGenerationRepository(
			dbConnection.db,
		);
		const generation = argsValues["generation-id"]
			? await generationRepository.loadGeneration(
					input.scanRunId,
					argsValues["generation-id"],
				)
			: await generationRepository.loadLatestValidGeneration(input.scanRunId);
		if (!generation)
			return fail(2, "Static Intelligence generation missing.", pretty);
		const result = await runStaticIntelligenceAgentQuery({
			db: dbConnection.db,
			input,
			semanticProvider: await maybeCreateEmbeddingProvider({
				db: dbConnection.db,
				scanRunId: input.scanRunId,
				includeSemantic: Boolean(input.includeSemantic),
				env,
			}),
			exportPayload: generation.export.payload,
		});
		writeResult(result, pretty);
		return 0;
	} catch (error) {
		if (
			error instanceof StaticIntelligenceScanRunNotFoundError ||
			error instanceof StaticIntelligenceAgentQueryInvalidRequestError ||
			error instanceof StaticIntelligenceGenerationValidationError ||
			error instanceof ZodError
		) {
			return fail(2, message(error), pretty);
		}
		return fail(1, message(error), pretty);
	} finally {
		dbConnection.sqlite.close();
	}
}

async function maybeCreateEmbeddingProvider(params: {
	db: ReturnType<typeof createDbConnection>["db"];
	scanRunId: string;
	includeSemantic: boolean;
	env: ReturnType<typeof readAppEnv>;
}): Promise<EmbeddingProvider | undefined> {
	if (!params.includeSemantic) return undefined;
	const repository = new StaticIntelligenceEmbeddingRepository(params.db);
	const indexedCount = await repository.countIndexedRows(params.scanRunId);
	if (indexedCount === 0) return undefined;
	try {
		return createAzureOpenAiProviderFromAppEnv(params.env);
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

function parseTopK(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed)) throw new Error("--top-k must be an integer.");
	return parsed;
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
