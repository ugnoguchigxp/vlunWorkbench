import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection, type DbConnection } from "../db";
import {
	buildStaticIntelligenceExport,
	StaticIntelligenceCodeStructureSnapshotMismatchError,
	StaticIntelligenceScanRunNotFoundError,
} from "../modules/static-intelligence/export-builder";
import { codeStructureSnapshotSchema } from "../../shared/schemas/static-intelligence-code-structure.schema";
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
				"code-structure-snapshot": { type: "string" },
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
	const codeStructureSnapshotPath = argsValues["code-structure-snapshot"];
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
	if (generationId && codeStructureSnapshotPath) {
		writeResult({
			ok: false,
			status: "failed",
			message:
				"--generation-id cannot be combined with --code-structure-snapshot.",
		});
		return 2;
	}

	let dbConnection: DbConnection | undefined;
	try {
		const codeStructureSnapshot = codeStructureSnapshotPath
			? await readCodeStructureSnapshot(codeStructureSnapshotPath)
			: undefined;
		const env = readAppEnv();
		dbConnection = createDbConnection(env.databaseUrl);
		const generation = codeStructureSnapshot
			? null
			: generationId
				? await new StaticIntelligenceGenerationRepository(
						dbConnection.db,
					).loadGeneration(scanRunId, generationId)
				: await new StaticIntelligenceGenerationRepository(
						dbConnection.db,
					).loadLatestValidGeneration(scanRunId);
		if (!codeStructureSnapshot && !generation) {
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
		const exportPayload =
			generation?.export.payload ??
			(await buildStaticIntelligenceExport(dbConnection.db, scanRunId, {
				codeStructureSnapshot,
			}));
		const outputMetadata = outputPath
			? await writeOutputFile(outputPath, exportPayload, pretty)
			: undefined;

		writeResult(
			{
				ok: true,
				status: "completed",
				scanRunId,
				...(outputMetadata ? { output: outputMetadata } : {}),
				...(generation ? { generationId: generation.generationId } : {}),
				export: exportPayload,
			},
			pretty,
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			error instanceof StaticIntelligenceScanRunNotFoundError ||
			error instanceof StaticIntelligenceCodeStructureSnapshotMismatchError ||
			error instanceof StaticIntelligenceGenerationValidationError ||
			message.startsWith("Invalid code structure snapshot:")
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

async function readCodeStructureSnapshot(snapshotPath: string) {
	const content = await fs.readFile(snapshotPath, "utf8").catch((error) => {
		const code =
			error && typeof error === "object" && "code" in error
				? String(error.code)
				: "unknown";
		throw new Error(
			`Invalid code structure snapshot: failed to read snapshot file (${code}).`,
		);
	});
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		throw new Error(
			`Invalid code structure snapshot: failed to parse JSON: ${message(error)}`,
		);
	}
	const result = codeStructureSnapshotSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(
			`Invalid code structure snapshot: ${result.error.issues[0]?.message ?? "schema validation failed"}`,
		);
	}
	return result.data;
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

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main();
