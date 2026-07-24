import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { createWritableTestDbConnection } from "../../db/testing/connection";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanRuns,
	toolRuns,
	users,
} from "../../db/schema";
import { buildRiskCommunities } from "./community-builder";
import { buildStaticIntelligenceExport } from "./export-builder";
import { buildSecurityLandscape } from "./landscape-builder";

const NOW = new Date("2026-07-05T12:00:00.000Z");
const GENERATED_AT = new Date("2026-07-05T12:30:00.000Z");

describe("Static Intelligence community and landscape builders", () => {
	let connection: DbConnection;
	let userId: string;
	let projectId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "static-intel-landscape@example.com",
				passwordHash: "password",
				displayName: "Static Intel Landscape User",
				role: "member",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		userId = user.id;

		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "Landscape Target Project",
				repoPath: "/workspace/landscape",
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		projectId = project.id;
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("builds a same-file candidate-only community", async () => {
		const scanRunId = await seedScanWithTool();
		const firstFindingId = await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-xss-1",
			title: "Reflected XSS",
		});
		const secondFindingId = await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.sql.injection",
			fingerprint: "fp-sqli-1",
			title: "SQL injection",
		});

		const exportPayload = await exportFor(scanRunId);
		const communities = buildRiskCommunities(exportPayload);
		const sameFile = communities.find((community) =>
			community.basis.includes("same_file"),
		);

		expect(sameFile).toMatchObject({
			candidateOnly: true,
			fileRefs: ["src/app.ts"],
			findingIds: [firstFindingId, secondFindingId].sort((a, b) =>
				a.localeCompare(b),
			),
		});
	});

	it("builds a high-confidence same-scanner-rule community", async () => {
		const scanRunId = await seedScanWithTool();
		await seedFinding({
			scanRunId,
			path: "src/routes/a.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-xss-1",
			title: "Reflected XSS A",
		});
		await seedFinding({
			scanRunId,
			path: "src/routes/b.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-xss-2",
			title: "Reflected XSS B",
		});

		const communities = buildRiskCommunities(await exportFor(scanRunId));
		const sameRule = communities.find((community) =>
			community.basis.includes("same_scanner_rule"),
		);

		expect(sameRule).toMatchObject({
			confidence: "high",
			ruleIds: ["typescript.express.xss"],
			scannerRefs: ["semgrep"],
		});
	});

	it("keeps semantic-only communities at low confidence", async () => {
		const scanRunId = await seedScanWithTool();
		const firstFindingId = await seedFinding({
			scanRunId,
			path: "src/a.ts",
			ruleId: "typescript.xss.a",
			fingerprint: "fp-semantic-a",
			title: "Reflected XSS A",
		});
		const secondFindingId = await seedFinding({
			scanRunId,
			path: "src/b.ts",
			ruleId: "typescript.xss.b",
			fingerprint: "fp-semantic-b",
			title: "Reflected XSS B",
		});
		await seedFinding({
			scanRunId,
			path: "src/c.ts",
			ruleId: "typescript.xss.c",
			fingerprint: "fp-semantic-c",
			title: "Reflected XSS C",
		});

		const communities = buildRiskCommunities(await exportFor(scanRunId), {
			semanticCandidates: [
				{
					stableKey: "semantic-xss",
					findingIds: [firstFindingId, secondFindingId],
				},
			],
		});
		const semantic = communities.find((community) =>
			community.basis.includes("semantic"),
		);

		expect(semantic?.confidence).toBe("low");
	});

	it("does not emit semantic communities for findings outside the export", async () => {
		const scanRunId = await seedScanWithTool();
		const findingId = await seedFinding({
			scanRunId,
			path: "src/a.ts",
			ruleId: "typescript.xss.a",
			fingerprint: "fp-semantic-a",
			title: "Reflected XSS A",
		});

		const communities = buildRiskCommunities(await exportFor(scanRunId), {
			semanticCandidates: [
				{
					stableKey: "semantic-unknown",
					findingIds: [findingId, "missing-finding-id"],
				},
			],
		});
		const semantic = communities.find((community) =>
			community.basis.includes("semantic"),
		);

		expect(semantic).toMatchObject({
			findingIds: [findingId],
			degradedReasons: ["semantic candidate referenced unknown finding"],
		});
		expect(semantic?.findingIds).not.toContain("missing-finding-id");
	});

	it("preserves graph evidence and artifact references", async () => {
		const scanRunId = await seedScanWithTool();
		const artifactId = await seedArtifact(scanRunId);
		const firstFindingId = await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-xss-1",
			title: "Reflected XSS",
		});
		const secondFindingId = await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.sql.injection",
			fingerprint: "fp-sqli-1",
			title: "SQL injection",
		});
		const firstEvidenceId = await seedEvidence({
			findingId: firstFindingId,
			artifactId,
			path: "src/app.ts",
		});
		const secondEvidenceId = await seedEvidence({
			findingId: secondFindingId,
			artifactId,
			path: "src/app.ts",
		});

		const communities = buildRiskCommunities(await exportFor(scanRunId));
		const sameFile = communities.find((community) =>
			community.basis.includes("same_file"),
		);

		expect(sameFile?.evidenceRefs).toEqual(
			[firstEvidenceId, secondEvidenceId].sort((a, b) => a.localeCompare(b)),
		);
		expect(sameFile?.artifactRefs).toEqual([artifactId]);
	});

	it("represents zero finding landscape without safe wording", async () => {
		const scanRunId = await seedScanRun();
		const landscape = buildSecurityLandscape(await exportFor(scanRunId));
		const serialized = JSON.stringify(landscape).toLowerCase();

		expect(landscape.risk.band).toBe("none");
		expect(landscape.risk.findingCount).toBe(0);
		expect(serialized).not.toContain("safe");
		expect(serialized).not.toContain("secure");
	});

	it("reports missing review as remediation focus", async () => {
		const scanRunId = await seedScanWithTool();
		await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-xss",
			title: "Reflected XSS",
		});

		const landscape = buildSecurityLandscape(await exportFor(scanRunId));

		expect(landscape.remediation.reviewStatus).toBe("missing");
		expect(landscape.remediation.hasImprovementRequest).toBe(false);
		expect(landscape.remediation.openFocus).toContain("scan review missing");
		expect(landscape.remediation.openFocus).toContain(
			"improvement request missing",
		);
	});

	it("reports weak evidence when evidence is not artifact-backed", async () => {
		const scanRunId = await seedScanWithTool();
		const findingId = await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-weak-evidence",
			title: "Reflected XSS",
		});
		await seedEvidence({ findingId, path: "src/app.ts" });

		const landscape = buildSecurityLandscape(await exportFor(scanRunId));

		expect(landscape.evidence.weakEvidenceFindingIds).toEqual([findingId]);
		expect(landscape.remediation.openFocus).toContain("weak or missing evidence");
	});

	it("counts only evidence refs with stored_as edges as artifact-backed", async () => {
		const scanRunId = await seedScanWithTool();
		const artifactId = await seedArtifact(scanRunId);
		const findingId = await seedFinding({
			scanRunId,
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-mixed-evidence",
			title: "Reflected XSS",
		});
		const artifactBackedEvidenceId = await seedEvidence({
			findingId,
			artifactId,
			path: "src/app.ts",
		});
		const unbackedEvidenceId = await seedEvidence({
			findingId,
			path: "src/app.ts",
		});

		const landscape = buildSecurityLandscape(await exportFor(scanRunId));

		expect(landscape.evidence.artifactBackedEvidenceRefs).toEqual([
			artifactBackedEvidenceId,
		]);
		expect(landscape.evidence.artifactBackedEvidenceRefs).not.toContain(
			unbackedEvidenceId,
		);
	});


	it("reports unknown file coverage as not covered", async () => {
		const scanRunId = await seedScanWithTool();
		await seedFinding({
			scanRunId,
			ruleId: "typescript.unknown.path",
			fingerprint: "fp-unknown-path",
			title: "Unknown path finding",
		});

		const landscape = buildSecurityLandscape(await exportFor(scanRunId));

		expect(landscape.coverage.status).not.toBe("covered");
		expect(landscape.coverage.unknownFileCount).toBeGreaterThan(0);
		expect(landscape.remediation.openFocus).toContain("unknown file path");
	});

	it("produces deterministic community and landscape output", async () => {
		const scanRunId = await seedScanWithTool();
		await seedFinding({
			scanRunId,
			path: "src/b.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-b",
			title: "Reflected XSS B",
		});
		await seedFinding({
			scanRunId,
			path: "src/a.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "fp-a",
			title: "Reflected XSS A",
		});

		const firstExport = await exportFor(scanRunId);
		const secondExport = await exportFor(scanRunId);

		expect(buildRiskCommunities(firstExport)).toEqual(
			buildRiskCommunities(secondExport),
		);
		expect(buildSecurityLandscape(firstExport)).toEqual(
			buildSecurityLandscape(secondExport),
		);
	});

	async function exportFor(scanRunId: string) {
		return buildStaticIntelligenceExport(connection.db, scanRunId, {
			generatedAt: GENERATED_AT,
		});
	}

	async function seedScanWithTool() {
		const scanRunId = await seedScanRun();
		await connection.db.insert(toolRuns).values({
			scanRunId,
			toolName: "semgrep",
			toolVersion: "1.100.0",
			command: "semgrep scan",
			status: "completed",
			exitCode: 0,
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 4000),
			createdAt: NOW,
			updatedAt: NOW,
		});
		return scanRunId;
	}

	async function seedScanRun() {
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: new Date(NOW.getTime() + 5000),
				createdByUserId: userId,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		return scanRun.id;
	}

	async function seedArtifact(scanRunId: string) {
		const [toolRun] = await connection.db
			.select()
			.from(toolRuns)
			.where(eq(toolRuns.scanRunId, scanRunId))
			.limit(1);
		const [artifact] = await connection.db
			.insert(scanArtifacts)
			.values({
				scanRunId,
				toolRunId: toolRun.id,
				kind: "raw_result",
				format: "json",
				path: "artifacts/semgrep.json",
				sha256: "fake-sha",
				sizeBytes: 200,
				metadata: {},
				createdAt: NOW,
			})
			.returning();
		return artifact.id;
	}

	async function seedFinding(params: {
		scanRunId: string;
		path?: string;
		ruleId: string;
		fingerprint: string;
		title: string;
	}) {
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId: params.scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: params.ruleId,
				title: params.title,
				description: "User-controlled value reaches a dangerous sink.",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: params.path
					? { path: params.path, startLine: 12 }
					: {},
				fingerprint: params.fingerprint,
				metadata: {},
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		return finding.id;
	}

	async function seedEvidence(params: {
		findingId: string;
		artifactId?: string;
		path: string;
	}) {
		const [evidence] = await connection.db
			.insert(findingEvidences)
			.values({
				findingId: params.findingId,
				kind: "source-location",
				title: "Source location",
				artifactId: params.artifactId,
				location: { path: params.path, startLine: 12 },
				snippet: "res.send(req.query.name);",
				metadata: {},
				createdAt: NOW,
			})
			.returning();
		return evidence.id;
	}
});

describe("Static Intelligence phase 31 CLIs", () => {
	let tempDir: string;
	let dbUrl: string;
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let scanRunId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "static-intelligence-phase31-cli-"),
		);
		dbUrl = `file:${path.join(tempDir, "test.sqlite")}`;
		connection = createWritableTestDbConnection(dbUrl);
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "static-intel-phase31-cli@example.com",
				passwordHash: "password",
				displayName: "Static Intel Phase31 CLI User",
				role: "member",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		userId = user.id;

		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "Phase31 CLI Target Project",
				repoPath: tempDir,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		projectId = project.id;

		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: new Date(NOW.getTime() + 5000),
				createdByUserId: userId,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		scanRunId = scanRun.id;

		await connection.db.insert(toolRuns).values({
			scanRunId,
			toolName: "semgrep",
			toolVersion: "1.100.0",
			command: "semgrep scan",
			status: "completed",
			exitCode: 0,
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 4000),
			createdAt: NOW,
			updatedAt: NOW,
		});
		await seedCliFinding({
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "cli-fp-xss-1",
			title: "Reflected XSS A",
		});
		await seedCliFinding({
			path: "src/app.ts",
			ruleId: "typescript.express.xss",
			fingerprint: "cli-fp-xss-2",
			title: "Reflected XSS B",
		});

		connection.sqlite.close();
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("returns one successful communities JSON object", () => {
		const result = runCli(
			"api/cli/intelligence-communities.ts",
			["--scan-run-id", scanRunId],
			dbUrl,
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			status: "completed",
			version: "v1",
			projectId,
			scanRunId,
		});
		expect(payload.communities.length).toBeGreaterThan(0);
		expect(payload.communities.every((community: { candidateOnly: boolean }) => community.candidateOnly)).toBe(true);
		expect(payload.degradedReasons).toContain("completed scan review missing");
	});

	it("returns one successful landscape JSON object", () => {
		const result = runCli(
			"api/cli/intelligence-landscape.ts",
			["--scan-run-id", scanRunId],
			dbUrl,
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		const payload = JSON.parse(result.stdout);
		expect(payload).toMatchObject({
			ok: true,
			status: "completed",
			version: "v1",
			projectId,
			scanRunId,
		});
		expect(payload.landscape.risk.findingCount).toBe(2);
		expect(payload.communities.length).toBeGreaterThan(0);
		expect(payload.degradedReasons).toContain("completed scan review missing");
	});

	it("returns JSON failure when communities scan-run-id is missing", () => {
		const result = runCli("api/cli/intelligence-communities.ts", [], dbUrl);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			status: "failed",
			message: "Missing required argument: --scan-run-id is required.",
		});
	});

	it("returns JSON failure when landscape scan-run-id is missing", () => {
		const result = runCli("api/cli/intelligence-landscape.ts", [], dbUrl);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			status: "failed",
			message: "Missing required argument: --scan-run-id is required.",
		});
	});

	it("returns JSON failure when communities DB initialization fails", () => {
		const result = runCli(
			"api/cli/intelligence-communities.ts",
			["--scan-run-id", scanRunId],
			"file:/missing-parent-dir/vuln-workbench.sqlite",
		);

		expect(result.status).toBe(1);
		expect(result.stdout.trim()).toMatch(/^\{[\s\S]*\}$/);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			status: "failed",
		});
	});

	it("returns JSON failure when landscape DB initialization fails", () => {
		const result = runCli(
			"api/cli/intelligence-landscape.ts",
			["--scan-run-id", scanRunId],
			"file:/missing-parent-dir/vuln-workbench.sqlite",
		);

		expect(result.status).toBe(1);
		expect(result.stdout.trim()).toMatch(/^\{[\s\S]*\}$/);
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			status: "failed",
		});
	});

	it("does not expose the unimplemented semantic communities option", () => {
		const result = runCli(
			"api/cli/intelligence-communities.ts",
			["--scan-run-id", scanRunId, "--include-semantic", "true"],
			dbUrl,
		);

		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			ok: false,
			status: "failed",
		});
	});

	async function seedCliFinding(params: {
		path: string;
		ruleId: string;
		fingerprint: string;
		title: string;
	}) {
		await connection.db.insert(findings).values({
			scanRunId,
			projectId,
			sourceTool: "semgrep",
			ruleId: params.ruleId,
			title: params.title,
			description: "User-controlled value reaches a dangerous sink.",
			severity: "high",
			confidence: "static",
			status: "open",
			primaryLocation: { path: params.path, startLine: 12 },
			fingerprint: params.fingerprint,
			metadata: {},
			createdAt: NOW,
			updatedAt: NOW,
		});
	}
});

function runCli(scriptPath: string, args: string[], dbUrl: string) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: process.cwd(),
		env: { ...process.env, DATABASE_URL: dbUrl },
		encoding: "utf8",
	});
}

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of sqlFiles) {
		const sqlPath = path.resolve(migrationsDir, filename);
		connection.sqlite.exec(readFileSync(sqlPath, "utf8"));
	}
}
