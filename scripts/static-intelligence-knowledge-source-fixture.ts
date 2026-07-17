import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { createDbConnection, type DbConnection } from "../api/db";
import { getSqliteWriterClient } from "../api/db/writer/client";
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

const VERSION = "v1";
const NOW = new Date("2026-07-06T12:00:00.000Z");
const MISSING_SCAN_RUN_ID = "00000000-0000-4000-8000-000000000001";
const RAW_SNIPPET_MARKER = "SECRET_FIXTURE_SNIPPET_SHOULD_NOT_LEAK";
const RAW_ARTIFACT_MARKER = "SECRET_FIXTURE_ARTIFACT_BODY_SHOULD_NOT_LEAK";
const RAW_REVIEW_MARKER = "SECRET_FIXTURE_REVIEW_BODY_SHOULD_NOT_LEAK";
const RAW_TOKEN_MARKER = "SECRET_FIXTURE_TOKEN_SHOULD_NOT_LEAK";
const RAW_SCANNER_MARKER = "SECRET_FIXTURE_SCANNER_STDOUT_SHOULD_NOT_LEAK";
const REQUIRED_MCP_TOOLS = [
	"vuln_list_knowledge_sources",
	"vuln_get_knowledge_source_manifest",
	"vuln_get_guardrail_material",
	"vuln_get_evidence_bundle",
	"vuln_get_verification_commands",
	"vuln_get_code_structure_snapshot",
] as const;

type FixtureCheck = {
	name: string;
	status: "passed";
	detail?: Record<string, unknown>;
};

type FixtureOptions = {
	keepTemp: boolean;
	skipMcp: boolean;
};

type FixturePaths = {
	tempRoot: string;
	dbPath: string;
	artifactRoot: string;
	repoPath: string;
};

type CommandResult = {
	label: string;
	status: number;
	stdout: string;
	stderr: string;
	payload: Record<string, unknown>;
};

class FixtureFailure extends Error {
	constructor(
		message: string,
		readonly failedCheck?: string,
	) {
		super(message);
		this.name = "FixtureFailure";
	}
}

function log(message: string): void {
	console.error(`[static-intel-fixture] ${message}`);
}

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
		DATABASE_URL: `file:${paths.dbPath}`,
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

async function runFixture(params: {
	options: FixtureOptions;
	paths: FixturePaths;
	env: Record<string, string>;
	checks: FixtureCheck[];
	scanRunId: string;
	findingIds: string[];
}) {
	const { options, paths, env, checks, scanRunId, findingIds } = params;
	await assertCheck(checks, "temp paths are isolated under os tmpdir", () => {
		assertPathInside(paths.tempRoot, os.tmpdir(), "tempRoot");
		assertPathInside(paths.dbPath, paths.tempRoot, "dbPath");
		assertPathInside(paths.artifactRoot, paths.tempRoot, "artifactRoot");
		assertPathInside(paths.repoPath, paths.tempRoot, "repoPath");
	});

	log("running Static Intelligence CLI chain");
	const codeStructureSnapshotPath = path.join(
		paths.tempRoot,
		"code-structure-snapshot.json",
	);
	const firstCodeStructure = runCommand(
		"intelligence:code-structure first",
		[
			"run",
			"intelligence:code-structure",
			"--",
			"--project-path",
			paths.repoPath,
		],
		env,
	);
	const secondCodeStructure = runCommand(
		"intelligence:code-structure second",
		[
			"run",
			"intelligence:code-structure",
			"--",
			"--project-path",
			paths.repoPath,
		],
		env,
	);
	await fs.writeFile(
		codeStructureSnapshotPath,
		JSON.stringify(firstCodeStructure.payload.snapshot),
		"utf8",
	);
	const generationBuild = runCommand(
		"intelligence:build",
		[
			"run",
			"intelligence:build",
			"--",
			"--scan-run-id",
			scanRunId,
			"--include-semantic",
			"false",
		],
		env,
	);
	const exportResult = runCommand(
		"intelligence:export",
		["run", "intelligence:export", "--", "--scan-run-id", scanRunId],
		env,
	);
	const codeStructureExport = runCommand(
		"intelligence:export with code structure",
		[
			"run",
			"intelligence:export",
			"--",
			"--scan-run-id",
			scanRunId,
			"--code-structure-snapshot",
			codeStructureSnapshotPath,
		],
		env,
	);
	const projectOverview = runCommand(
		"agent-query project_overview",
		[
			"run",
			"intelligence:agent-query",
			"--",
			"--scan-run-id",
			scanRunId,
			"--kind",
			"project_overview",
		],
		env,
	);
	const evidenceBundle = runCommand(
		"agent-query evidence_bundle",
		[
			"run",
			"intelligence:agent-query",
			"--",
			"--scan-run-id",
			scanRunId,
			"--kind",
			"evidence_bundle",
			"--finding-id",
			findingIds[0],
		],
		env,
	);
	const verificationCommands = runCommand(
		"agent-query verification_commands",
		[
			"run",
			"intelligence:agent-query",
			"--",
			"--scan-run-id",
			scanRunId,
			"--kind",
			"verification_commands",
			"--finding-id",
			findingIds[0],
		],
		env,
	);
	const firstManifest = runCommand(
		"intelligence:knowledge-source first",
		["run", "intelligence:knowledge-source", "--", "--scan-run-id", scanRunId],
		env,
	);
	const secondManifest = runCommand(
		"intelligence:knowledge-source second",
		["run", "intelligence:knowledge-source", "--", "--scan-run-id", scanRunId],
		env,
	);
	const firstMaterial = runCommand(
		"intelligence:guardrail-material first",
		[
			"run",
			"intelligence:guardrail-material",
			"--",
			"--scan-run-id",
			scanRunId,
			"--include-markdown",
			"true",
		],
		env,
	);
	const secondMaterial = runCommand(
		"intelligence:guardrail-material second",
		[
			"run",
			"intelligence:guardrail-material",
			"--",
			"--scan-run-id",
			scanRunId,
			"--include-markdown",
			"true",
		],
		env,
	);
	const missingManifest = runCommand(
		"intelligence:knowledge-source missing scan",
		[
			"run",
			"intelligence:knowledge-source",
			"--",
			"--scan-run-id",
			MISSING_SCAN_RUN_ID,
		],
		env,
		2,
	);
	const missingMaterial = runCommand(
		"intelligence:guardrail-material missing scan",
		[
			"run",
			"intelligence:guardrail-material",
			"--",
			"--scan-run-id",
			MISSING_SCAN_RUN_ID,
		],
		env,
		2,
	);
	const commandResults = [
		firstCodeStructure,
		secondCodeStructure,
		exportResult,
		generationBuild,
		codeStructureExport,
		projectOverview,
		evidenceBundle,
		verificationCommands,
		firstManifest,
		secondManifest,
		firstMaterial,
		secondMaterial,
		missingManifest,
		missingMaterial,
	];

	await assertCheck(checks, "cli stdout is one JSON object", () => {
		for (const result of commandResults) {
			assertOneJsonObject(result.label, result.stdout);
		}
	});
	await assertCheck(
		checks,
		"missing scan failures use JSON stdout and no stderr",
		() => {
			for (const result of [missingManifest, missingMaterial]) {
				if (result.payload.ok !== false) {
					throw new Error(`${result.label} did not return ok:false`);
				}
				if (result.stderr !== "") {
					throw new Error(
						`${result.label} wrote expected failure details to stderr`,
					);
				}
			}
		},
	);
	await assertCheck(checks, "hashes and material ids are stable", () => {
		const firstManifestPayload = manifestPayload(firstManifest.payload);
		const secondManifestPayload = manifestPayload(secondManifest.payload);
		if (
			firstManifestPayload.source.contentHash !==
			secondManifestPayload.source.contentHash
		) {
			throw new Error("manifest contentHash changed across repeated runs");
		}
		if (
			firstManifestPayload.source.exportHash !==
			secondManifestPayload.source.exportHash
		) {
			throw new Error("manifest exportHash changed across repeated runs");
		}
		if (
			firstMaterial.payload.sourceManifest?.exportHash !==
			firstManifestPayload.source.exportHash
		) {
			throw new Error(
				"material sourceManifest exportHash does not match manifest",
			);
		}
		const firstIds = materialIds(firstMaterial.payload);
		const secondIds = materialIds(secondMaterial.payload);
		if (JSON.stringify(firstIds) !== JSON.stringify(secondIds)) {
			throw new Error("guardrail material ids changed across repeated runs");
		}
		const firstHashes = materialHashes(firstMaterial.payload);
		const secondHashes = materialHashes(secondMaterial.payload);
		if (JSON.stringify(firstHashes) !== JSON.stringify(secondHashes)) {
			throw new Error("guardrail material hashes changed across repeated runs");
		}
	});
	await assertCheck(
		checks,
		"code structure snapshot is redacted and stable",
		() => {
			const firstSnapshot = objectRecord(
				firstCodeStructure.payload.snapshot,
				"first code structure snapshot",
			);
			const secondSnapshot = objectRecord(
				secondCodeStructure.payload.snapshot,
				"second code structure snapshot",
			);
			if (
				objectRecord(firstSnapshot.project, "code structure project").rootPath
			) {
				throw new Error("code structure snapshot included rootPath by default");
			}
			if (String(firstSnapshot.status) !== "completed") {
				throw new Error(
					"code structure snapshot did not complete for fixture repo",
				);
			}
			const normalizedFirst = normalizeGeneratedAt(firstSnapshot);
			const normalizedSecond = normalizeGeneratedAt(secondSnapshot);
			if (
				JSON.stringify(normalizedFirst) !== JSON.stringify(normalizedSecond)
			) {
				throw new Error("code structure snapshot changed across repeated runs");
			}
			const enrichedExport = objectRecord(
				objectRecord(
					codeStructureExport.payload.export,
					"code structure export",
				).codeStructure,
				"code structure enrichment",
			);
			if (enrichedExport.status !== "available") {
				throw new Error("export did not consume code structure snapshot");
			}
		},
	);
	await assertCheck(
		checks,
		"unsafe markers and temp paths are redacted",
		() => {
			for (const result of commandResults) {
				assertNoUnsafeMarkers(result.label, result.stdout, paths);
			}
		},
	);
	await assertCheck(checks, "agent query outputs are candidate-only", () => {
		for (const result of [
			projectOverview,
			evidenceBundle,
			verificationCommands,
		]) {
			assertCandidateOnlyAgentResult(result.payload);
		}
	});
	await assertCheck(checks, "guardrail materials are candidate-only", () => {
		assertGuardrailMaterialsCandidateOnly(firstMaterial.payload);
	});
	await assertCheck(checks, "manifest provenance is complete", () => {
		const manifest = manifestPayload(firstManifest.payload);
		if (!manifest.source.sourceId || !manifest.source.scanRunId) {
			throw new Error("manifest source provenance is incomplete");
		}
		if (!manifest.source.contentHash || !manifest.source.exportHash) {
			throw new Error("manifest hashes are missing");
		}
		for (const bundle of manifest.availableBundles) {
			if (!Array.isArray(bundle.command)) {
				throw new Error(
					`available bundle ${bundle.kind} command is not argv array`,
				);
			}
		}
		const codeStructureBundle = manifest.availableBundles.find(
			(bundle) => bundle.kind === "code_structure_snapshot",
		);
		if (!codeStructureBundle) {
			throw new Error("manifest is missing code_structure_snapshot bundle");
		}
		if (
			!codeStructureBundle.command.includes(manifest.source.scanRunId) ||
			!codeStructureBundle.command.includes(manifest.generation.generationId)
		) {
			throw new Error(
				"code structure bundle command is not pinned to the source generation",
			);
		}
		if (codeStructureBundle.command.includes(paths.repoPath)) {
			throw new Error("code structure bundle command leaked fixture repo path");
		}
	});
	await assertCheck(checks, "guardrail material provenance is complete", () => {
		if (!firstMaterial.payload.sourceManifest) {
			throw new Error("guardrail material result is missing sourceManifest");
		}
		for (const material of materials(firstMaterial.payload)) {
			const sourceRefs = material.source?.sourceRefs;
			if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
				throw new Error(`material ${material.id} is missing source refs`);
			}
		}
	});
	await assertCheck(checks, "evidence bundle has refs", () => {
		if (!hasNonEmptyArray(evidenceBundle.payload.refs, "sourceRefs")) {
			throw new Error("evidence bundle source refs are missing");
		}
		if (!hasNonEmptyArray(evidenceBundle.payload.refs, "evidenceRefs")) {
			throw new Error("evidence bundle evidence refs are missing");
		}
	});
	await assertCheck(
		checks,
		"verification commands are scan-level candidates",
		() => {
			assertCandidateOnlyAgentResult(verificationCommands.payload);
			const results = arrayProp(verificationCommands.payload, "results");
			for (const item of results) {
				const record = objectRecord(item, "verification command item");
				if (arrayProp(record, "findingIds").length > 0) {
					throw new Error("verification command over-attributed finding refs");
				}
				if (arrayProp(record, "evidenceRefs").length > 0) {
					throw new Error("verification command over-attributed evidence refs");
				}
				if (arrayProp(record, "fileRefs").length > 0) {
					throw new Error("verification command over-attributed file refs");
				}
				if (!arrayProp(record, "sourceRefs").includes(`handoff:${scanRunId}`)) {
					throw new Error(
						"verification command source ref is not scan-level handoff",
					);
				}
				const metadata = objectRecord(record.metadata, "verification metadata");
				if (metadata.executed === true || metadata.status === "passed") {
					throw new Error("verification command claimed execution");
				}
			}
		},
	);

	let mcpToolNames: string[] = [];
	if (options.skipMcp) {
		checks.push({ name: "mcp checks skipped by option", status: "passed" });
	} else {
		log("running MCP list-tools and smoke checks");
		const listTools = runCommand(
			"mcp list-tools",
			["run", "mcp:static-intelligence", "--", "--list-tools"],
			env,
		);
		const smoke = runCommand(
			"mcp smoke",
			["run", "mcp:static-intelligence", "--", "--smoke"],
			env,
		);
		await assertCheck(checks, "mcp stdout is one JSON object", () => {
			assertOneJsonObject(listTools.label, listTools.stdout);
			assertOneJsonObject(smoke.label, smoke.stdout);
		});
		await assertCheck(checks, "mcp outputs do not leak unsafe data", () => {
			assertNoUnsafeMarkers(listTools.label, listTools.stdout, paths);
			assertNoUnsafeMarkers(smoke.label, smoke.stdout, paths);
		});
		await assertCheck(checks, "mcp tool list includes Phase 36 tools", () => {
			mcpToolNames = toolNames(listTools.payload);
			for (const toolName of REQUIRED_MCP_TOOLS) {
				if (!mcpToolNames.includes(toolName)) {
					throw new Error(`missing MCP tool ${toolName}`);
				}
			}
			const smokeToolNames = arrayProp(smoke.payload, "tools");
			for (const toolName of REQUIRED_MCP_TOOLS) {
				if (!smokeToolNames.includes(toolName)) {
					throw new Error(`MCP smoke missing tool ${toolName}`);
				}
			}
		});
	}

	const manifest = manifestPayload(firstManifest.payload);
	const result = {
		ok: true,
		status: "completed",
		version: VERSION,
		generatedAt: new Date().toISOString(),
		scanRunId,
		findingIds,
		checks,
		outputs: {
			exportHash: manifest.source.exportHash,
			manifestContentHash: manifest.source.contentHash,
			manifestExportHash: manifest.source.exportHash,
			codeStructureSnapshotRef: String(
				objectRecord(
					objectRecord(
						codeStructureExport.payload.export,
						"code structure export",
					).codeStructure,
					"code structure enrichment",
				).snapshotRef,
			),
			guardrailMaterialCount: materials(firstMaterial.payload).length,
			guardrailMaterialIds: materialIds(firstMaterial.payload),
			agentQueryKinds: [
				String(projectOverview.payload.queryKind),
				String(evidenceBundle.payload.queryKind),
				String(verificationCommands.payload.queryKind),
			],
			mcpToolNames,
			mcpSkipped: options.skipMcp,
		},
	};
	if (!options.keepTemp) {
		await assertCheck(checks, "final result does not leak unsafe data", () => {
			assertNoUnsafeMarkers(
				"final fixture result",
				JSON.stringify(result),
				paths,
			);
		});
	}
	return result;
}

function runCommand(
	label: string,
	args: string[],
	env: Record<string, string>,
	expectedStatus = 0,
): CommandResult {
	const proc = spawnSync(process.execPath, silentBunRunArgs(args), {
		cwd: process.cwd(),
		env: { ...process.env, ...env },
		encoding: "utf8",
	});
	const status = proc.status ?? (proc.error ? 1 : 0);
	const stdout = proc.stdout ?? "";
	const stderr = proc.stderr ?? "";
	if (status !== expectedStatus) {
		throw new FixtureFailure(
			`${label} exited ${status}, expected ${expectedStatus}: ${stderr || stdout}`,
			`${label} exit status`,
		);
	}
	return {
		label,
		status,
		stdout,
		stderr,
		payload: parseJsonObject(label, stdout),
	};
}

function silentBunRunArgs(args: string[]): string[] {
	if (args[0] !== "run") return args;
	return ["--silent", ...args];
}

function parseJsonObject(
	label: string,
	stdout: string,
): Record<string, unknown> {
	assertOneJsonObject(label, stdout);
	const parsed = JSON.parse(stdout.trim());
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new FixtureFailure(`${label} did not produce a JSON object`, label);
	}
	return parsed as Record<string, unknown>;
}

function assertOneJsonObject(label: string, stdout: string): void {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
		throw new FixtureFailure(
			`${label} stdout is not exactly one JSON object`,
			label,
		);
	}
	try {
		JSON.parse(trimmed);
	} catch (error) {
		throw new FixtureFailure(
			`${label} stdout is not parseable JSON: ${message(error)}`,
			label,
		);
	}
}

async function assertCheck(
	checks: FixtureCheck[],
	name: string,
	fn: () => void | Promise<void>,
): Promise<void> {
	try {
		await fn();
		checks.push({ name, status: "passed" });
	} catch (error) {
		throw new FixtureFailure(message(error), name);
	}
}

function assertNoUnsafeMarkers(
	label: string,
	payloadText: string,
	paths: FixturePaths,
): void {
	const unsafeValues = [
		RAW_SNIPPET_MARKER,
		RAW_ARTIFACT_MARKER,
		RAW_REVIEW_MARKER,
		RAW_TOKEN_MARKER,
		RAW_SCANNER_MARKER,
		paths.tempRoot,
		paths.dbPath,
		paths.repoPath,
		paths.artifactRoot,
	];
	for (const unsafeValue of unsafeValues) {
		if (payloadText.includes(unsafeValue)) {
			throw new Error(`${label} leaked unsafe value ${unsafeValue}`);
		}
	}
}

function assertPathInside(
	candidate: string,
	parent: string,
	label: string,
): void {
	const relative = path.relative(path.resolve(parent), path.resolve(candidate));
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`${label} is not inside ${parent}`);
	}
}

function assertCandidateOnlyAgentResult(
	payload: Record<string, unknown>,
): void {
	const summary = objectRecord(payload.summary, "agent query summary");
	if (summary.candidateOnly !== true) {
		throw new Error("agent query summary is not candidate-only");
	}
	for (const item of arrayProp(payload, "results")) {
		const record = objectRecord(item, "agent query result item");
		if (record.candidateOnly !== true) {
			throw new Error(`agent query item ${record.id} is not candidate-only`);
		}
	}
}

function assertGuardrailMaterialsCandidateOnly(
	payload: Record<string, unknown>,
): void {
	for (const material of materials(payload)) {
		if (material.candidateOnly !== true) {
			throw new Error(
				`guardrail material ${material.id} is not candidate-only`,
			);
		}
	}
}

function manifestPayload(payload: Record<string, unknown>) {
	return objectRecord(payload.manifest, "manifest") as {
		source: {
			sourceId: string;
			scanRunId: string;
			contentHash: string;
			exportHash: string;
		};
		generation: { generationId: string };
		availableBundles: Array<{ kind: string; command: string[] }>;
	};
}

function materials(
	payload: Record<string, unknown>,
): Array<Record<string, any>> {
	return arrayProp(payload, "materials").map((item) =>
		objectRecord(item, "guardrail material"),
	) as Array<Record<string, any>>;
}

function materialIds(payload: Record<string, unknown>): string[] {
	return materials(payload)
		.map((material) => String(material.id))
		.sort((a, b) => a.localeCompare(b));
}

function materialHashes(payload: Record<string, unknown>): string[] {
	return materials(payload)
		.map((material) => String(material.metadata?.materialHash))
		.sort((a, b) => a.localeCompare(b));
}

function normalizeGeneratedAt(
	value: Record<string, unknown>,
): Record<string, unknown> {
	return {
		...value,
		generatedAt: "<generatedAt>",
	};
}

function toolNames(payload: Record<string, unknown>): string[] {
	return arrayProp(payload, "tools")
		.map((tool) => objectRecord(tool, "MCP tool"))
		.map((tool) => String(tool.name));
}

function hasNonEmptyArray(value: unknown, key: string): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = (value as Record<string, unknown>)[key];
	return Array.isArray(item) && item.length > 0;
}

function arrayProp(payload: Record<string, unknown>, key: string): unknown[] {
	const value = payload[key];
	if (!Array.isArray(value)) throw new Error(`${key} is not an array`);
	return value;
}

function objectRecord(value: unknown, label: string): Record<string, any> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is not an object`);
	}
	return value as Record<string, any>;
}

function failureResult(
	messageText: string,
	options: { failedCheck?: string; tempRoot?: string } = {},
) {
	return {
		ok: false,
		status: "failed",
		version: VERSION,
		message: messageText,
		...(options.failedCheck ? { failedCheck: options.failedCheck } : {}),
		...(options.tempRoot ? { tempRoot: options.tempRoot } : {}),
	};
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

process.exitCode = await main();
