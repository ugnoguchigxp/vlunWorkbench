import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { createDbConnection, type DbConnection } from "../api/db";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanReviews,
	scanRuns,
	toolRuns,
	users,
} from "../api/db/schema";
import { getSqliteWriterClient } from "../api/db/writer/client";
import { runFixture } from "./static-intelligence-fixture-cases";
import {
	type FixtureCheck,
	FixtureFailure,
	type FixtureOptions,
	type FixturePaths,
	NOW,
	RAW_ARTIFACT_MARKER,
	RAW_REVIEW_MARKER,
	RAW_SCANNER_MARKER,
	RAW_SNIPPET_MARKER,
	RAW_TOKEN_MARKER,
} from "./static-intelligence-fixture-model";
import {
	failureResult,
	log,
	message,
} from "./static-intelligence-fixture-support";

function writeFinalResult(payload: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main(): Promise<number> {
	let options: FixtureOptions;
	let paths: FixturePaths | undefined;
	try {
		options = parseFixtureOptions();
	} catch (error) {
		writeFinalResult(failureResult(message(error)));
		return 2;
	}

	try {
		paths = await createFixturePaths();
		const env = fixtureEnv(paths);
		const checks: FixtureCheck[] = [];
		const seeded = await setupDatabase(paths);
		const result = await runFixture({
			options,
			paths,
			env,
			checks,
			scanRunId: seeded.scanRunId,
			findingIds: seeded.findingIds,
		});

		if (!options.keepTemp) {
			await fs.rm(paths.tempRoot, { recursive: true, force: true });
			result.checks.push({
				name: "cleanup removed temp root",
				status: "passed",
			});
		}

		writeFinalResult({
			...result,
			...(options.keepTemp
				? {
						tempRoot: paths.tempRoot,
						dbPath: paths.dbPath,
						artifactRoot: paths.artifactRoot,
						repoPath: paths.repoPath,
					}
				: {}),
		});
		return 0;
	} catch (error) {
		if (paths && !options.keepTemp) {
			await fs
				.rm(paths.tempRoot, { recursive: true, force: true })
				.catch((cleanupError) =>
					log(`cleanup failed: ${message(cleanupError)}`),
				);
		}
		if (!(error instanceof FixtureFailure)) {
			console.error(error);
		}
		writeFinalResult(
			failureResult(message(error), {
				failedCheck:
					error instanceof FixtureFailure ? error.failedCheck : undefined,
				tempRoot: options.keepTemp ? paths?.tempRoot : undefined,
			}),
		);
		return 1;
	}
}

function parseFixtureOptions(): FixtureOptions {
	const parsed = parseArgs({
		args: process.argv.slice(2),
		options: {
			"keep-temp": { type: "string" },
			"skip-mcp": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	return {
		keepTemp:
			parseBooleanOption(parsed.values["keep-temp"], "--keep-temp") ?? false,
		skipMcp:
			parseBooleanOption(parsed.values["skip-mcp"], "--skip-mcp") ?? false,
	};
}

function parseBooleanOption(
	value: string | undefined,
	flagName: string,
): boolean | undefined {
	if (value === undefined) return undefined;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error(`${flagName} must be true or false.`);
}

async function createFixturePaths(): Promise<FixturePaths> {
	const tempRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "vuln-workbench-static-intel-"),
	);
	const paths = {
		tempRoot,
		dbPath: path.join(tempRoot, "fixture.sqlite"),
		artifactRoot: path.join(tempRoot, "artifacts"),
		repoPath: path.join(tempRoot, "repo"),
	};
	await fs.mkdir(path.join(paths.repoPath, "src"), { recursive: true });
	await fs.mkdir(paths.artifactRoot, { recursive: true });
	await fs.writeFile(
		path.join(paths.repoPath, "src", "app.ts"),
		`const marker = "${RAW_TOKEN_MARKER}";\nexport function render(input: string) { return marker ? input : input; }\n`,
		"utf8",
	);
	await fs.writeFile(
		path.join(paths.repoPath, "src", "auth.ts"),
		"export function validate(value: string) { return Boolean(value); }\n",
		"utf8",
	);
	return paths;
}

function fixtureEnv(paths: FixturePaths): Record<string, string> {
	return {
		NODE_ENV: "test",
		DATABASE_URL: `file:${paths.dbPath}`,
		PROJECT_ALLOWED_ROOTS: paths.repoPath,
		SCAN_ARTIFACT_ROOT: path.join(paths.artifactRoot, "scans"),
		REPRODUCTION_ARTIFACT_ROOT: path.join(paths.artifactRoot, "reproductions"),
		DYNAMIC_ARTIFACT_ROOT: path.join(paths.artifactRoot, "dynamic"),
		DAST_ARTIFACT_ROOT: path.join(paths.artifactRoot, "dast"),
	};
}

async function setupDatabase(paths: FixturePaths): Promise<{
	scanRunId: string;
	findingIds: string[];
}> {
	log("applying migrations and seeding fixture rows");
	await applyMigrations(`file:${paths.dbPath}`);
	const connection = createDbConnection(`file:${paths.dbPath}`);
	try {
		return await seedFixtureRows(connection, paths);
	} finally {
		await connection.writerClient?.close({ shutdownIfOwned: true });
		connection.sqlite.close();
	}
}

async function applyMigrations(databaseUrl: string): Promise<void> {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	const writer = getSqliteWriterClient(databaseUrl);
	try {
		for (const filename of sqlFiles) {
			await writer.applyMigration(
				filename,
				readFileSync(path.resolve(migrationsDir, filename), "utf8"),
			);
		}
	} finally {
		await writer.close({ shutdownIfOwned: true });
	}
}

async function seedFixtureRows(
	connection: DbConnection,
	paths: FixturePaths,
): Promise<{ scanRunId: string; findingIds: string[] }> {
	const [user] = await connection.db
		.insert(users)
		.values({
			email: "static-intelligence-fixture@example.com",
			passwordHash: "fixture-password-hash",
			displayName: "Static Intelligence Fixture User",
			role: "admin",
			isActive: true,
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	const [project] = await connection.db
		.insert(projects)
		.values({
			ownerUserId: user.id,
			name: "Static Intelligence Fixture Project",
			repoPath: paths.repoPath,
			defaultBranch: "main",
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	const [scanRun] = await connection.db
		.insert(scanRuns)
		.values({
			projectId: project.id,
			profile: "baseline",
			status: "completed",
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 5000),
			createdByUserId: user.id,
			summary: "Deterministic Static Intelligence fixture scan.",
			metadata: {},
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	const [toolRun] = await connection.db
		.insert(toolRuns)
		.values({
			scanRunId: scanRun.id,
			toolName: "semgrep",
			toolVersion: "1.100.0",
			command: "semgrep scan --json",
			status: "completed",
			exitCode: 0,
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 4000),
			metadata: {
				stdout: RAW_SCANNER_MARKER,
				token: RAW_TOKEN_MARKER,
			},
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	const [artifact] = await connection.db
		.insert(scanArtifacts)
		.values({
			scanRunId: scanRun.id,
			toolRunId: toolRun.id,
			kind: "raw_result",
			format: "json",
			path: "artifacts/semgrep.json",
			sha256: "f".repeat(64),
			sizeBytes: 200,
			metadata: {
				rawContent: RAW_ARTIFACT_MARKER,
				token: RAW_TOKEN_MARKER,
			},
			createdAt: NOW,
		})
		.returning();
	const [highFinding] = await connection.db
		.insert(findings)
		.values({
			scanRunId: scanRun.id,
			projectId: project.id,
			sourceTool: "semgrep",
			ruleId: "typescript.express.xss",
			title: "Reflected XSS",
			description: "User-controlled value reaches a dangerous sink.",
			severity: "high",
			confidence: "static",
			status: "open",
			primaryLocation: { path: "src/app.ts", startLine: 12 },
			fingerprint: "fixture-xss",
			metadata: {},
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	const [mediumFinding] = await connection.db
		.insert(findings)
		.values({
			scanRunId: scanRun.id,
			projectId: project.id,
			sourceTool: "semgrep",
			ruleId: "typescript.auth.validation",
			title: "Weak validation",
			description: "Authentication input validation is incomplete.",
			severity: "medium",
			confidence: "static",
			status: "open",
			primaryLocation: { path: "src/auth.ts", startLine: 4 },
			fingerprint: "fixture-auth-validation",
			metadata: {},
			createdAt: NOW,
			updatedAt: NOW,
		})
		.returning();
	await connection.db.insert(findingEvidences).values([
		{
			findingId: highFinding.id,
			kind: "source-location",
			title: "XSS source location",
			artifactId: artifact.id,
			location: { path: "src/app.ts", startLine: 12 },
			snippet: RAW_SNIPPET_MARKER,
			metadata: {},
			createdAt: NOW,
		},
		{
			findingId: mediumFinding.id,
			kind: "source-location",
			title: "Weak validation source location",
			artifactId: null,
			location: { path: "src/auth.ts", startLine: 4 },
			snippet: null,
			metadata: { note: "weak-evidence fixture row" },
			createdAt: NOW,
		},
	]);
	await connection.db.insert(scanReviews).values({
		scanRunId: scanRun.id,
		projectId: project.id,
		provider: "openai",
		model: "gpt-4o-mini",
		status: "completed",
		summary: `Review completed. ${RAW_REVIEW_MARKER}`,
		riskOverview: "High risk XSS finding with weaker validation follow-up.",
		priorityNotes: ["Fix the scanner-backed input validation risks."],
		coverageNotes: [],
		falsePositiveHotspots: [],
		recommendedNextActions: ["Patch and test."],
		findingTriageHints: [],
		confidenceNotes: [],
		inputBundle: { rawReviewMarker: RAW_REVIEW_MARKER },
		output: buildReviewOutput(paths.repoPath),
		startedAt: NOW,
		completedAt: new Date(NOW.getTime() + 1000),
		createdAt: NOW,
		updatedAt: NOW,
	});
	return {
		scanRunId: scanRun.id,
		findingIds: [highFinding.id, mediumFinding.id],
	};
}

function buildReviewOutput(repoPath: string) {
	return {
		summary: "Review completed.",
		riskOverview: "High risk XSS finding with weaker validation follow-up.",
		priorityNotes: ["Fix the XSS first."],
		coverageNotes: [],
		falsePositiveHotspots: [],
		recommendedNextActions: ["Patch and test."],
		findingTriageHints: [],
		confidenceNotes: [],
		improvementRequest: {
			title: "Fix scanner-backed input validation risks",
			objective: "Remove unsafe rendering and validation gaps.",
			scope: ["Stored scan evidence only.", RAW_REVIEW_MARKER],
			priorityPlan: [],
			implementationTasks: [],
			acceptanceCriteria: [
				"Injected HTML is escaped.",
				`${repoPath}/src/app.ts should not appear in knowledge output.`,
			],
			verificationCommands: [
				"bun test ./api/modules/static-intelligence/*.test.ts",
			],
			constraints: ["Do not call external systems."],
			nonGoals: ["Do not register contextStill knowledge."],
			handoffPrompt: RAW_REVIEW_MARKER,
		},
	};
}

process.exitCode = await main();
