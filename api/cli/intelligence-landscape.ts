import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection, type DbConnection } from "../db";
import { buildRiskCommunities } from "../modules/static-intelligence/community-builder";
import {
	buildStaticIntelligenceExport,
	StaticIntelligenceScanRunNotFoundError,
} from "../modules/static-intelligence/export-builder";
import { buildSecurityLandscape } from "../modules/static-intelligence/landscape-builder";
import { staticIntelligenceLandscapeResultSchema } from "../../shared/schemas/static-intelligence-landscape.schema";

function writeResult(payload: Record<string, unknown>, pretty = false): void {
	console.log(JSON.stringify(payload, null, pretty ? 2 : undefined));
}

function parseBooleanOption(
	name: string,
	value: string | undefined,
	defaultValue: boolean,
): boolean {
	if (value === undefined) return defaultValue;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${name} must be true or false.`);
}

async function main(): Promise<number> {
	let argsValues: Record<string, string | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"scan-run-id": { type: "string" },
				"include-communities": { type: "string" },
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
	if (!scanRunId) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Missing required argument: --scan-run-id is required.",
		});
		return 2;
	}

	let pretty: boolean;
	let includeCommunities: boolean;
	try {
		pretty = parseBooleanOption("--pretty", argsValues.pretty, false);
		includeCommunities = parseBooleanOption(
			"--include-communities",
			argsValues["include-communities"],
			true,
		);
	} catch (error) {
		writeResult({
			ok: false,
			status: "failed",
			message: error instanceof Error ? error.message : String(error),
		});
		return 2;
	}

	let dbConnection: DbConnection | null = null;
	try {
		const env = readAppEnv();
		dbConnection = createDbConnection(env.databaseUrl);
		const exportPayload = await buildStaticIntelligenceExport(
			dbConnection.db,
			scanRunId,
		);
		const communities = includeCommunities
			? buildRiskCommunities(exportPayload)
			: undefined;
		const result = staticIntelligenceLandscapeResultSchema.parse({
			ok: true,
			status: "completed",
			version: "v1",
			generatedAt: new Date().toISOString(),
			projectId: exportPayload.project.id,
			scanRunId,
			landscape: buildSecurityLandscape(exportPayload, communities ?? []),
			...(communities ? { communities } : {}),
			degradedReasons: [...exportPayload.scanSummary.degradedReasons],
		});
		writeResult(result, pretty);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (error instanceof StaticIntelligenceScanRunNotFoundError) {
			writeResult({ ok: false, status: "failed", message });
			return 2;
		}

		console.error(message);
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to build static intelligence landscape: ${message}`,
		});
		return 1;
	} finally {
		dbConnection?.sqlite.close();
	}
}

process.exitCode = await main();
