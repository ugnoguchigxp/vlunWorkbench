import fs from "node:fs/promises";
import path from "node:path";

async function main() {
	const packageJsonPath = path.resolve(process.cwd(), "package.json");
	const packageJsonContent = await fs.readFile(packageJsonPath, "utf8");
	const packageJson = JSON.parse(packageJsonContent);

	const expectedCommands = [
		"scan:profile",
		"review:finding",
		"decision:finding",
		"report:scan",
		"repro:finding",
		"dynamic:run",
		"scan:dast",
	];

	const commands: Record<string, boolean> = {};
	const missing: string[] = [];

	for (const cmd of expectedCommands) {
		const exists = Boolean(packageJson.scripts?.[cmd]);
		commands[cmd] = exists;
		if (!exists) {
			missing.push(`command:${cmd}`);
		}
	}

	const expectedRouteFiles = [
		"projects.route.ts",
		"scans.route.ts",
		"scan-reports.route.ts",
		"findings.route.ts",
		"finding-reviews.route.ts",
		"finding-decisions.route.ts",
		"reproductions.route.ts",
		"dynamic.route.ts",
		"dast.route.ts",
	];

	const routes: Record<string, boolean> = {};
	for (const file of expectedRouteFiles) {
		const filePath = path.resolve(process.cwd(), "api", "routes", file);
		let exists = false;
		try {
			await fs.access(filePath);
			exists = true;
		} catch {}
		routes[file] = exists;
		if (!exists) {
			missing.push(`route:${file}`);
		}
	}

	const schemaPath = path.resolve(process.cwd(), "api", "db", "schema.ts");
	const schemaContent = await fs.readFile(schemaPath, "utf8");

	const expectedTables = [
		"projects",
		"scanRuns",
		"toolRuns",
		"scanArtifacts",
		"findings",
		"findingEvidences",
		"findingReviews",
		"findingDecisions",
		"scanReports",
		"reproductionRuns",
		"reproductionArtifacts",
		"reproductionEvidence",
		"dynamicRuns",
		"dynamicArtifacts",
		"dynamicEvidence",
		"dastTargetConfigs",
		"dastProfileConfigs",
		"dastRuns",
		"dastArtifacts",
		"dastEvidence",
	];

	const schemas: Record<string, boolean> = {};
	for (const tbl of expectedTables) {
		const exists = schemaContent.includes(tbl);
		schemas[tbl] = exists;
		if (!exists) {
			missing.push(`schema:${tbl}`);
		}
	}

	const ok = missing.length === 0;

	console.log(
		JSON.stringify(
			{
				ok,
				commands,
				routes,
				schemas,
				missing,
			},
			null,
			2,
		),
	);

	if (!ok) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error(JSON.stringify({ ok: false, error: err.message }));
	process.exit(1);
});
