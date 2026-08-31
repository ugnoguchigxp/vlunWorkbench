import { parseArgs } from "node:util";
import { openReadonlySqliteSnapshot } from "../db";

async function main() {
	const parsed = parseArgs({
		args: process.argv.slice(2),
		options: { "project-root": { type: "string" } },
		strict: true,
		allowPositionals: false,
	});
	const projectRoot = parsed.values["project-root"]?.trim();
	const databaseUrl = process.env.DATABASE_URL?.trim();
	if (!projectRoot) throw new Error("--project-root is required.");
	if (!databaseUrl) throw new Error("DATABASE_URL is required.");
	const sqlite = openReadonlySqliteSnapshot(databaseUrl);
	try {
		const count = sqlite
			.query("select count(*) as count from projects")
			.get() as { count?: number } | null;
		const exact = sqlite
			.query(
				"select count(*) as count from projects where canonical_repo_path = ? or repo_path = ?",
			)
			.get(projectRoot, projectRoot) as { count?: number } | null;
		const projectCount = Number(count?.count ?? 0);
		const exactTargetCount = Number(exact?.count ?? 0);
		process.stdout.write(
			`${JSON.stringify({
				ok: projectCount === 1 && exactTargetCount === 1,
				projectCount,
				exactTargetCount,
			})}\n`,
		);
	} finally {
		sqlite.close();
	}
}

await main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
