import fs from "node:fs/promises";
import path from "node:path";
import { eq, desc } from "drizzle-orm";
import { createDbConnection } from "../api/db";
import { projects, scanRuns, findings, dastTargetConfigs, users, dynamicProfileConfigs } from "../api/db/schema";
import { readAppEnv } from "../api/app/env";

function runCmd(args: string[], env: Record<string, string>): { ok: boolean; stdout: string; stderr: string } {
	const proc = Bun.spawnSync(["bun", ...args], {
		env: { ...process.env, ...env },
	});
	const stdout = proc.stdout.toString("utf8");
	const stderr = proc.stderr.toString("utf8");
	return {
		ok: proc.success,
		stdout,
		stderr,
	};
}

async function main() {
	const tempDbPath = "/tmp/vuln-workbench-phase12-temp.sqlite";
	const databaseUrl = `file:${tempDbPath}`;

	console.log(`[P7 Workflow] Cleaning up old temp DB at ${tempDbPath}...`);
	try {
		await fs.unlink(tempDbPath);
	} catch {}

	const envOverride = { DATABASE_URL: databaseUrl };

	console.log("[P7 Workflow] Running migrations...");
	const migrateResult = runCmd(["run", "api/cli/migrate.ts"], envOverride);
	if (!migrateResult.ok) {
		console.error(`Migration failed: ${migrateResult.stderr}`);
		process.exit(1);
	}

	console.log("[P7 Workflow] Creating mock user and project...");
	const dbConnection = createDbConnection(databaseUrl);
	const db = dbConnection.db;

	await db
		.insert(users)
		.values({
			id: "user-123",
			email: "fixture@example.com",
			passwordHash: "mock-hash",
			displayName: "Fixture User",
			role: "admin",
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

	const [project] = await db
		.insert(projects)
		.values({
			name: "Fixture Test Project",
			repoPath: process.cwd(),
			ownerUserId: "user-123",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();

	console.log(`[P7 Workflow] Created project with ID: ${project.id}`);

	console.log("[P7 Workflow] Inserting dynamic profile config...");
	await db
		.insert(dynamicProfileConfigs)
		.values({
			projectId: project.id,
			profileId: "bun-test",
			dynamicKind: "test",
			displayName: "Bun Test",
			enabled: true,
			commandJson: ["bun", "test"],
			workingDirectory: "",
			timeoutSec: 120,
			network: "none",
			writableWorkdir: false,
			allowProjectScripts: false,
			expectedArtifactsJson: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		});

	console.log("[P7 Workflow] Importing fixture scan results...");
	const importSemgrep = runCmd(
		[
			"run",
			"api/cli/scan-import.ts",
			"--",
			"--project-id",
			project.id,
			"--tool",
			"fixture",
			"--artifact",
			"tests/fixtures/scans/fixture-finding.json",
		],
		envOverride,
	);
	if (!importSemgrep.ok) {
		console.error(`Import Semgrep failed: ${importSemgrep.stderr || importSemgrep.stdout}`);
		process.exit(1);
	}
	const importPayload = JSON.parse(importSemgrep.stdout.trim());
	const scanRunId = importPayload.scanRunId;
	console.log(`[P7 Workflow] Imported scan run: ${scanRunId}`);

	// Let's get one finding from the DB
	const dbFinding = await db.query.findings.findFirst({
		where: eq(findings.projectId, project.id),
	});

	if (!dbFinding) {
		console.error("[P7 Workflow] No findings found in DB after import.");
		process.exit(1);
	}
	console.log(`[P7 Workflow] Selected finding: ${dbFinding.id}`);

	const mockReviewJsonPath = "/tmp/fixture-review-output.json";
	const mockReviewOutput = {
		summary: "This is a valid Slack token exposure.",
		likelyImpact: "Unauthorized Slack workspace access.",
		falsePositiveAssessment: {
			level: "low",
			reasoning: "The token has standard prefix and was tested.",
		},
		evidenceStrength: {
			level: "strong",
			reasoning: "Explicitly defined token matches pattern.",
		},
		remediationDirection: "Revoke token and store it in vault.",
		reviewerNotes: ["Observe hardcoded variable assignment."],
		confidenceAdjustment: "increase",
	};
	await fs.writeFile(mockReviewJsonPath, JSON.stringify(mockReviewOutput, null, 2), "utf8");

	console.log("[P7 Workflow] Running review:finding command...");
	// Use mock review runner via fixture output to avoid hitting OpenAI API
	const reviewFinding = runCmd(
		[
			"run",
			"api/cli/review-finding.ts",
			"--",
			"--finding-id",
			dbFinding.id,
			"--fixture-output",
			mockReviewJsonPath,
		],
		envOverride,
	);
	if (!reviewFinding.ok) {
		console.error(`Review finding failed: ${reviewFinding.stderr || reviewFinding.stdout}`);
		process.exit(1);
	}
	console.log("[P7 Workflow] Review finding succeeded.");

	console.log("[P7 Workflow] Running decision:finding command...");
	const decisionFinding = runCmd(
		[
			"run",
			"api/cli/decision-finding.ts",
			"--",
			"--finding-id",
			dbFinding.id,
			"--decision",
			"needs_fix",
			"--reason",
			"confirmed_by_evidence",
			"--comment",
			"Confirmed by integration test.",
		],
		envOverride,
	);
	if (!decisionFinding.ok) {
		console.error(`Decision finding failed: ${decisionFinding.stderr || decisionFinding.stdout}`);
		process.exit(1);
	}
	console.log("[P7 Workflow] Decision finding succeeded.");

	console.log("[P7 Workflow] Running report:scan command...");
	const reportScan = runCmd(
		["run", "api/cli/report-scan.ts", "--", "--scan-run-id", scanRunId, "--format", "markdown"],
		envOverride,
	);
	if (!reportScan.ok) {
		console.error(`Report scan failed: ${reportScan.stderr || reportScan.stdout}`);
		process.exit(1);
	}
	console.log("[P7 Workflow] Report scan succeeded.");

	console.log("[P7 Workflow] Updating selected finding sourceTool to gitleaks for reproduction...");
	await db.update(findings).set({ sourceTool: "gitleaks" }).where(eq(findings.id, dbFinding.id));

	console.log("[P7 Workflow] Running repro:finding command (dry-run)...");
	const reproFinding = runCmd(
		["run", "api/cli/repro-finding.ts", "--", "--finding-id", dbFinding.id, "--profile", "gitleaks-recheck", "--dry-run", "true"],
		envOverride,
	);
	if (!reproFinding.ok) {
		console.error(`Reproduction failed: ${reproFinding.stderr || reproFinding.stdout}`);
		process.exit(1);
	}
	console.log("[P7 Workflow] Reproduction dry-run succeeded.");

	console.log("[P7 Workflow] Running dynamic:run command (dry-run)...");
	const dynamicRun = runCmd(
		["run", "api/cli/dynamic-run.ts", "--", "--project-id", project.id, "--profile", "bun-test", "--dry-run", "true"],
		envOverride,
	);
	if (!dynamicRun.ok) {
		console.error(`Dynamic run failed: ${dynamicRun.stderr || dynamicRun.stdout}`);
		process.exit(1);
	}
	console.log("[P7 Workflow] Dynamic run dry-run succeeded.");

	console.log("[P7 Workflow] Running scan:dast command (dry-run)...");
	// To run DAST, we need a DAST target config. Let's insert one first.
	const [targetConfig] = await db
		.insert(dastTargetConfigs)
		.values({
			projectId: project.id,
			name: "Local Mock Target",
			origin: "http://localhost:8080",
			normalizedOrigin: "http://localhost:8080",
			enabled: true,
			allowLoopback: true,
			allowPrivateNetwork: false,
			allowedPathsJson: ["/"],
			excludedPathsJson: [],
			defaultHeadersJson: {},
			maxDepth: 0,
			maxRequests: 20,
			rateLimitPerSec: 2,
			timeoutSec: 120,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();

	const dastScan = runCmd(
		[
			"run",
			"api/cli/scan-dast.ts",
			"--",
			"--project-id",
			project.id,
			"--target-config-id",
			targetConfig.id,
			"--profile",
			"http-baseline",
			"--dry-run",
			"true",
		],
		envOverride,
	);
	if (!dastScan.ok) {
		console.error(`DAST scan failed: ${dastScan.stderr || dastScan.stdout}`);
		process.exit(1);
	}
	console.log("[P7 Workflow] DAST scan dry-run succeeded.");

	console.log("[P7 Workflow] Running traceability audit...");
	const auditTrace = runCmd(
		["run", "scripts/audit-phase12-traceability.ts", "--", "--database-url", databaseUrl],
		envOverride,
	);
	if (!auditTrace.ok) {
		console.error(`Traceability audit failed: ${auditTrace.stderr || auditTrace.stdout}`);
		process.exit(1);
	}
	console.log("[P7 Workflow] Traceability audit succeeded.");
	console.log(auditTrace.stdout);

	console.log("[P7 Workflow] Cleaning up temp DB...");
	dbConnection.sqlite.close(false);
	try {
		await fs.unlink(tempDbPath);
	} catch {}

	console.log("[P7 Workflow] SUCCESS: All fixture workflow steps completed and verified!");
}

main().catch((err) => {
	console.error(`Fixture workflow crashed: ${err.message}`);
	process.exit(1);
});
