import { parseArgs } from "node:util";
import { createDbConnection } from "../db";
import { readAppEnv } from "../app/env";
import { LlmTaskSchema } from "../modules/llm-settings/llm-settings.schema";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { FindingReviewRunner } from "../modules/reviews/finding-review-runner";
import { LlmRouter } from "../providers/llmRouter";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	let argsValues: any;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"finding-id": { type: "string" },
				task: { type: "string", default: "finding_review" },
				provider: { type: "string", default: "azure-openai" },
				"provider-endpoint-id": { type: "string" },
				model: { type: "string" },
				"max-snippet-lines": { type: "string" },
				"fixture-output": { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values;
	} catch (err: any) {
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${err.message}`,
		});
		process.exit(1);
	}

	const findingId = argsValues["finding-id"];
	const provider = argsValues.provider;
	const taskResult = LlmTaskSchema.safeParse(argsValues.task);
	if (!taskResult.success) {
		writeResult({
			ok: false,
			findingId,
			status: "failed",
			message: `Unsupported task: ${argsValues.task}`,
		});
		process.exit(1);
	}
	const task = taskResult.data;
	const providerEndpointId =
		argsValues["provider-endpoint-id"] ||
		(provider && provider !== "azure-openai" ? provider : undefined);
	const model = argsValues.model;
	const maxSnippetLinesStr = argsValues["max-snippet-lines"];
	const fixtureOutput = argsValues["fixture-output"];

	if (!findingId) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Missing required argument: --finding-id is required.",
		});
		process.exit(1);
	}

	const maxSnippetLines = maxSnippetLinesStr
		? Number.parseInt(maxSnippetLinesStr, 10)
		: undefined;

	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);

	const llmSettingsRepository = new LlmSettingsRepository(dbConnection.db, env);
	const llmRouter = new LlmRouter(llmSettingsRepository, env);

	try {
		const runner = new FindingReviewRunner(dbConnection.db, { llmRouter });
		const result = await runner.run(findingId, {
			task,
			providerEndpointId,
			providerName: provider,
			modelName: model,
			maxLines: maxSnippetLines,
			fixtureOutput,
		});

		if (result.ok) {
			writeResult({
				ok: true,
				findingId,
				reviewId: result.reviewId,
				status: "completed",
			});
		} else {
			writeResult({
				ok: false,
				findingId,
				reviewId: result.reviewId,
				status: "failed",
				message: result.error || "Review failed",
			});
			process.exit(1);
		}
	} catch (err: any) {
		writeResult({
			ok: false,
			findingId,
			status: "failed",
			message: err.message,
		});
		process.exit(1);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

await main();
