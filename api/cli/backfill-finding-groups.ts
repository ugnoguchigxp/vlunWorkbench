import { parseArgs } from "node:util";
import { desc, eq } from "drizzle-orm";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { scanRuns } from "../db/schema";
import { FindingGroupingRunner } from "../modules/scans/finding-grouping-runner";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main(): Promise<void> {
	const parsed = parseArgs({
		args: process.argv.slice(2),
		options: {
			"scan-run-id": { type: "string" },
			limit: { type: "string", default: "100" },
			"dry-run": { type: "boolean", default: false },
		},
		strict: true,
	});
	const scanRunId = parsed.values["scan-run-id"];
	const limit = Number.parseInt(parsed.values.limit ?? "100", 10);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
		throw new Error("--limit must be an integer between 1 and 10000.");
	}
	const env = readAppEnv();
	const connection = createDbConnection(env.databaseUrl);
	try {
		const candidates = scanRunId
			? await connection.db
					.select()
					.from(scanRuns)
					.where(eq(scanRuns.id, scanRunId))
			: await connection.db
					.select()
					.from(scanRuns)
					.orderBy(desc(scanRuns.completedAt), desc(scanRuns.id))
					.limit(limit);
		if (scanRunId && candidates.length === 0) {
			throw new Error(`Scan run not found: ${scanRunId}`);
		}
		const terminal = candidates.filter((scan) =>
			["completed", "failed", "cancelled"].includes(scan.status),
		);
		if (parsed.values["dry-run"]) {
			writeResult({
				ok: true,
				dryRun: true,
				requested: candidates.length,
				terminal: terminal.map((scan) => scan.id),
			});
			return;
		}
		const runner = new FindingGroupingRunner(connection.db);
		const results = [] as Array<{
			scanRunId: string;
			mode: string;
			issueCount: number;
			rawFindingCount: number;
			snapshotHash: string | null;
		}>;
		for (const scan of terminal) {
			const snapshot = await runner.ensureCurrentDeterministic(scan.id);
			results.push({
				scanRunId: scan.id,
				mode: snapshot.grouping.mode,
				issueCount: snapshot.grouping.issueCount,
				rawFindingCount: snapshot.grouping.rawFindingCount,
				snapshotHash: snapshot.grouping.snapshotHash,
			});
		}
		writeResult({
			ok: true,
			requested: candidates.length,
			skippedNonTerminal: candidates.length - terminal.length,
			backfilled: results.length,
			results,
		});
	} finally {
		connection.sqlite.close(false);
	}
}

void main().catch((error) => {
	writeResult({
		ok: false,
		status: "failed",
		message: error instanceof Error ? error.message : String(error),
	});
	process.exit(1);
});
