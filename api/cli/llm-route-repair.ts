import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import {
	LlmTaskSchema,
	type LlmSettingsResponse,
	type LlmTask,
} from "../modules/llm-settings/llm-settings.schema";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";

function writeJson(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

function routeSummary(settings: LlmSettingsResponse): Array<{
	task: LlmTask;
	providerEndpointId: string | null;
	model: string | null;
}> {
	return settings.taskRoutes.map((route) => ({
		task: route.task,
		providerEndpointId: route.primaryTarget?.providerEndpointId ?? null,
		model: route.primaryTarget?.model ?? null,
	}));
}

function parseTasks(input: string | undefined): LlmTask[] {
	if (!input?.trim()) {
		return ["finding_review", "scan_review", "report_summary"];
	}
	const tasks = input
		.split(",")
		.map((task) => task.trim())
		.filter(Boolean);
	if (tasks.length === 0) {
		throw new Error("Missing required argument: --tasks is required.");
	}
	return tasks.map((task) => LlmTaskSchema.parse(task));
}

async function main() {
	let argsValues: Record<string, string | boolean | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				provider: { type: "string" },
				model: { type: "string" },
				tasks: { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values;
	} catch (error) {
		writeJson({
			ok: false,
			status: "failed",
			message:
				error instanceof Error
					? `Failed to parse arguments: ${error.message}`
					: String(error),
		});
		process.exit(1);
	}

	try {
		const providerId = String(argsValues.provider ?? "").trim();
		const model = String(argsValues.model ?? "").trim();
		const tasks = parseTasks(
			typeof argsValues.tasks === "string" ? argsValues.tasks : undefined,
		);
		if (!providerId) {
			throw new Error("Missing required argument: --provider is required.");
		}
		if (!model) {
			throw new Error("Missing required argument: --model is required.");
		}

		const env = readAppEnv();
		const dbConnection = createDbConnection(env.databaseUrl);
		try {
			const repository = new LlmSettingsRepository(dbConnection.db, env);
			const settings = await repository.getSettings({
				maskSecrets: false,
				seedFromEnv: true,
			});
			writeJson({
				ok: true,
				stage: "before",
				routes: routeSummary(settings),
			});

			const provider = settings.providerEndpoints.find(
				(endpoint) => endpoint.id === providerId,
			);
			if (!provider) {
				throw new Error(`Provider endpoint is not configured: ${providerId}`);
			}
			if (!provider.models.includes(model)) {
				throw new Error(
					`Model ${model} is not configured on provider endpoint ${providerId}.`,
				);
			}

			const requestedTasks = new Set(tasks);
			const existingRoutes = new Map(
				settings.taskRoutes.map((route) => [route.task, route]),
			);
			for (const task of requestedTasks) {
				existingRoutes.set(task, {
					task,
					primaryTarget: {
						providerEndpointId: providerId,
						model,
					},
					fallbackTargets: existingRoutes.get(task)?.fallbackTargets ?? [],
					policy: existingRoutes.get(task)?.policy ?? {},
				});
			}

			await repository.updateSettings({
				providerEndpoints: settings.providerEndpoints,
				taskRoutes: Array.from(existingRoutes.values()),
			});
			const updated = await repository.getSettings({
				maskSecrets: false,
				seedFromEnv: false,
			});
			writeJson({
				ok: true,
				stage: "after",
				routes: routeSummary(updated).filter((route) =>
					requestedTasks.has(route.task),
				),
			});
		} finally {
			dbConnection.sqlite.close(false);
		}
	} catch (error) {
		writeJson({
			ok: false,
			status: "failed",
			message: error instanceof Error ? error.message : String(error),
		});
		process.exit(1);
	}
}

await main();
