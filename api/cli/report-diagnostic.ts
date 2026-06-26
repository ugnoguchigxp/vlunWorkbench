import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { buildZeroFindingDiagnosticReport } from "../modules/diagnostics/reports/zero-finding-report-builder";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
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
				kind: { type: "string", default: "zero-finding" },
				"output-path": { type: "string" },
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
	const kind = values.kind ?? "zero-finding";
	if (!projectId || !scanRunId) {
		writeResult({
			ok: false,
			message:
				"Missing required arguments: --project-id and --scan-run-id are required.",
		});
		process.exit(1);
	}
	if (kind !== "zero-finding") {
		writeResult({
			ok: false,
			projectId,
			scanRunId,
			message: `Unsupported diagnostic report kind: ${kind}`,
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
		const result = await buildZeroFindingDiagnosticReport({
			db: dbConnection.db,
			projectId,
			scanRunId,
		});
		if (values["output-path"] && result.artifactPath) {
			const markdown = await new ArtifactStorage().readTextArtifact(
				result.artifactPath,
			);
			await fs.writeFile(values["output-path"], markdown, "utf8");
		}
		writeResult({
			ok: result.ok,
			projectId,
			scanRunId,
			reportId: result.reportId,
			artifactId: result.artifactId,
			status: result.status,
			summary: result.summary,
			message: result.error,
		});
		if (!result.ok) process.exit(1);
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
