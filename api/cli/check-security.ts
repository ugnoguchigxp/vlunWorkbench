import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { SecurityCheckRunner } from "../modules/diagnostics/checks/check-runner";
import {
	ProjectRepository,
	ScanRepository,
} from "../modules/scans/repositories";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	let values: Record<string, string | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"project-id": { type: "string" },
				"scan-run-id": { type: "string" },
				category: { type: "string" },
				"check-id": { type: "string" },
				"output-summary": { type: "string" },
				"dry-run": { type: "string", default: "false" },
			},
			strict: true,
		});
		values = parsed.values as Record<string, string | undefined>;
	} catch (error) {
		writeResult({
			ok: false,
			message: `Failed to parse arguments: ${error instanceof Error ? error.message : String(error)}`,
		});
		process.exit(1);
	}

	const projectId = values["project-id"];
	const scanRunId = values["scan-run-id"];
	if (!projectId || !scanRunId) {
		writeResult({
			ok: false,
			message:
				"Missing required arguments: --project-id and --scan-run-id are required.",
		});
		process.exit(1);
	}

	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);
	try {
		const project = await new ProjectRepository(dbConnection.db).findById(
			projectId,
		);
		if (!project) {
			writeResult({
				ok: false,
				projectId,
				scanRunId,
				message: "Project not found",
			});
			process.exit(1);
		}
		const scan = await new ScanRepository(dbConnection.db).findById(scanRunId);
		if (!scan || scan.projectId !== projectId) {
			writeResult({
				ok: false,
				projectId,
				scanRunId,
				message: "Scan run not found for project",
			});
			process.exit(1);
		}
		const result = await new SecurityCheckRunner(dbConnection.db).run({
			projectId,
			scanRunId,
			category: values.category,
			checkId: values["check-id"],
			dryRun: values["dry-run"] === "true",
		});
		const payload = {
			ok: result.ok,
			projectId,
			scanRunId,
			resultCount: result.resultCount,
			statusCounts: result.statusCounts,
		};
		if (values["output-summary"]) {
			await fs.writeFile(
				values["output-summary"],
				JSON.stringify(payload, null, 2),
			);
		}
		writeResult(payload);
	} catch (error) {
		writeResult({
			ok: false,
			projectId,
			scanRunId,
			message: error instanceof Error ? error.message : String(error),
		});
		process.exit(1);
	} finally {
		dbConnection.sqlite.close(false);
	}
}

await main();
