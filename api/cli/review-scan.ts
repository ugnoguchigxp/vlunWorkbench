import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { LlmTaskSchema } from "../modules/llm-settings/llm-settings.schema";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { ScanReviewRunner } from "../modules/scans/scan-review-runner";
import { LlmRouter } from "../providers/llmRouter";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	let argsValues: Record<string, string | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"scan-run-id": { type: "string" },
				task: { type: "string", default: "scan_review" },
				provider: { type: "string", default: "azure-openai" },
				"provider-endpoint-id": { type: "string" },
				model: { type: "string" },
				"fixture-output": { type: "string" },
				"max-findings": { type: "string" },
				"max-evidence-per-finding": { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values as Record<string, string | undefined>;
	} catch (err) {
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${err instanceof Error ? err.message : String(err)}`,
		});
		process.exit(1);
	}

	const scanRunId = argsValues["scan-run-id"];
	if (!scanRunId) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Missing required argument: --scan-run-id is required.",
		});
		process.exit(1);
	}

	const taskResult = LlmTaskSchema.safeParse(argsValues.task);
	if (!taskResult.success) {
		writeResult({
			ok: false,
			scanRunId,
			status: "failed",
			message: `Unsupported task: ${argsValues.task}`,
		});
		process.exit(1);
	}

	const provider = argsValues.provider;
	const providerEndpointId =
		argsValues["provider-endpoint-id"] ||
		(provider && provider !== "azure-openai" ? provider : undefined);
	const maxFindings = argsValues["max-findings"]
		? Number.parseInt(argsValues["max-findings"], 10)
		: undefined;
	const maxEvidencePerFinding = argsValues["max-evidence-per-finding"]
		? Number.parseInt(argsValues["max-evidence-per-finding"], 10)
		: undefined;

	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);

	try {
		const llmSettingsRepository = new LlmSettingsRepository(
			dbConnection.db,
			env,
		);
		const llmRouter = new LlmRouter(llmSettingsRepository, env);
		const runner = new ScanReviewRunner(dbConnection.db, { llmRouter });
		const result = await runner.run(scanRunId, {
			task: taskResult.data,
			providerEndpointId,
			providerName: provider,
			modelName: argsValues.model,
			fixtureOutput: argsValues["fixture-output"],
			maxFindings,
			maxEvidencePerFinding,
		});

		if (result.ok) {
			writeResult({
				ok: true,
				scanRunId,
				reviewId: result.reviewId,
				status: "completed",
			});
		} else {
			writeResult({
				ok: false,
				scanRunId,
				reviewId: result.reviewId,
				status: "failed",
				message: result.error || "Review failed",
			});
			process.exit(1);
		}
	} catch (err) {
		writeResult({
			ok: false,
			scanRunId,
			status: "failed",
			message: err instanceof Error ? err.message : String(err),
		});
		process.exit(1);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

await main();
