import { parseArgs } from "node:util";
import { createDbConnection } from "../db";
import { readAppEnv } from "../app/env";
import { FindingReviewRunner } from "../modules/reviews/finding-review-runner";
import { createAzureOpenAiProviderFromAppEnv } from "../providers/azureOpenAiProviderFactory";
import type { LlmProvider } from "../providers/types";

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
				provider: { type: "string", default: "azure-openai" },
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
	if (provider !== "azure-openai") {
		writeResult({
			ok: false,
			findingId,
			status: "failed",
			message: `Unsupported provider: ${provider}. Only 'azure-openai' is supported.`,
		});
		process.exit(1);
	}

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

	let llmProvider: LlmProvider | undefined;
	try {
		llmProvider = createAzureOpenAiProviderFromAppEnv(env);
	} catch {
		// Keep undefined, runner will fail cleanly if needed
	}

	try {
		const runner = new FindingReviewRunner(dbConnection.db, llmProvider);
		const result = await runner.run(findingId, {
			providerName: provider,
			modelName: model ?? env.azureOpenAiDeployment,
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
