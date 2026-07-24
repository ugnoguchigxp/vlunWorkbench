import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection, type DbConnection } from "../db";
import {
	StaticIntelligenceGenerationRepository,
	StaticIntelligenceGenerationValidationError,
} from "../modules/static-intelligence/generation-repository";

function writeResult(payload: Record<string, unknown>, pretty = false): void {
	console.log(JSON.stringify(payload, null, pretty ? 2 : undefined));
}

function parsePretty(value: string | undefined): boolean {
	if (value === undefined) return false;
	return value === "true";
}

async function main(): Promise<number> {
	let argsValues: Record<string, string | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"scan-run-id": { type: "string" },
				"generation-id": { type: "string" },
				output: { type: "string" },
				pretty: { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values as Record<string, string | undefined>;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${message}`,
		});
		return 2;
	}

	const scanRunId = argsValues["scan-run-id"];
	const outputPath = argsValues.output;
	const generationId = argsValues["generation-id"];
	const pretty = parsePretty(argsValues.pretty);
	if (!scanRunId) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Missing required argument: --scan-run-id is required.",
		});
		return 2;
	}

	if (
		argsValues.pretty !== undefined &&
		argsValues.pretty !== "true" &&
		argsValues.pretty !== "false"
	) {
		writeResult({
			ok: false,
			status: "failed",
			message: "--pretty must be true or false.",
		});
		return 2;
	}
	let dbConnection: DbConnection | undefined;
	try {
		const env = readAppEnv();
		dbConnection = createDbConnection(env.databaseUrl);
		const repository = new StaticIntelligenceGenerationRepository(
			dbConnection.db,
		);
		const generation = generationId
			? await repository.loadGeneration(scanRunId, generationId)
			: await repository.loadLatestValidGeneration(scanRunId);
		if (!generation) {
			writeResult(
				{
					ok: false,
					status: "failed",
					message: "Static Intelligence generation missing.",
				},
				pretty,
			);
			return 2;
		}
		const exportPayload = generation.export.payload;
		const outputMetadata = outputPath
			? await writeOutputFile(outputPath, exportPayload, pretty)
			: undefined;

		writeResult(
			{
				ok: true,
				status: "completed",
				scanRunId,
				...(outputMetadata ? { output: outputMetadata } : {}),
				generationId: generation.generationId,
				export: exportPayload,
			},
			pretty,
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			error instanceof StaticIntelligenceGenerationValidationError ||
			message.startsWith("Static Intelligence generation")
		) {
			writeResult({
				ok: false,
				status: "failed",
				message,
			});
			return 2;
		}

		console.error(message);
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to build static intelligence export: ${message}`,
		});
		return 1;
	} finally {
		dbConnection?.sqlite.close();
	}
}

async function writeOutputFile(
	outputPath: string,
	exportPayload: unknown,
	pretty: boolean,
) {
	const content = JSON.stringify(exportPayload, null, pretty ? 2 : undefined);
	await fs.writeFile(outputPath, content, "utf8");
	return {
		path: outputPath,
		sha256: createHash("sha256").update(content).digest("hex"),
	};
}

process.exitCode = await main();
