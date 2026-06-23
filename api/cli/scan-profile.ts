import { parseArgs } from "node:util";
import fs from "node:fs/promises";
import { createDbConnection } from "../db";
import { readAppEnv } from "../app/env";
import { ProjectRepository } from "../modules/scans/repositories";
import { runProfileScan } from "../modules/scans/profile-runner";
import { getProfileById } from "../modules/scans/profiles";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	// biome-ignore lint/suspicious/noExplicitAny: CLI args
	let argsValues: any;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-id": { type: "string" },
				profile: { type: "string", default: "baseline" },
				"timeout-sec": { type: "string" },
				"continue-on-tool-failure": { type: "string", default: "true" },
				"output-summary": { type: "string" },
				"dry-run": { type: "string", default: "false" },
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

	const projectId = argsValues["project-id"];
	const profileId = argsValues.profile;
	const timeoutSecStr = argsValues["timeout-sec"];
	const continueOnToolFailure =
		argsValues["continue-on-tool-failure"] !== "false";
	const outputSummaryPath = argsValues["output-summary"];
	const dryRun = argsValues["dry-run"] === "true";

	// Validate profile exists
	const profile = getProfileById(profileId);
	if (!profile) {
		writeResult({
			ok: false,
			status: "failed",
			message: `Invalid profile: ${profileId}`,
		});
		process.exit(1);
	}

	const timeoutSec = timeoutSecStr
		? Number.parseInt(timeoutSecStr, 10)
		: undefined;
	if (
		timeoutSec !== undefined &&
		(!Number.isFinite(timeoutSec) ||
			!Number.isInteger(timeoutSec) ||
			timeoutSec <= 0)
	) {
		writeResult({
			ok: false,
			status: "failed",
			message: "--timeout-sec must be a positive integer.",
		});
		process.exit(1);
	}

	if (dryRun) {
		// Output dry-run details and exit
		const toolOrder = profile.tools.map((t) => t.toolId);
		const resolvedTools = profile.tools.map((t) => ({
			toolId: t.toolId,
			displayName: t.displayName,
			required: t.required,
			timeoutSec: t.timeoutSec ?? timeoutSec ?? profile.defaultTimeoutSec,
			options: t.options ?? {},
		}));
		writeResult({
			dryRun: true,
			profileId,
			toolOrder,
			resolvedTools,
		});
		process.exit(0);
	}

	if (!projectId) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Missing required argument: --project-id is required.",
		});
		process.exit(1);
	}

	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);

	try {
		const projectRepo = new ProjectRepository(dbConnection.db);
		const project = await projectRepo.findById(projectId);
		if (!project) {
			writeResult({
				ok: false,
				status: "failed",
				message: `Project not found with id: ${projectId}`,
			});
			process.exit(1);
		}

		const result = await runProfileScan({
			db: dbConnection.db,
			projectId,
			profileId,
			repoPath: project.repoPath,
			continueOnToolFailure,
			timeoutSec,
		});

		const outputPayload = {
			ok: result.ok,
			scanRunId: result.scanRunId,
			profileId: result.profileId,
			status: result.status,
			profileOutcome: result.profileOutcome,
			toolResults: result.toolResults.map((r) => ({
				toolId: r.toolId,
				toolRunId: r.toolRunId,
				status: r.status,
				findingCount: r.findingCount,
			})),
		};

		if (outputSummaryPath) {
			await fs.writeFile(
				outputSummaryPath,
				JSON.stringify(outputPayload, null, 2),
				"utf8",
			);
		}

		writeResult(outputPayload);

		if (!result.ok) {
			process.exit(1);
		}
	} catch (err: any) {
		writeResult({
			ok: false,
			status: "failed",
			message: err.message,
			toolResults: [],
		});
		process.exit(1);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

main();
