import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { findings } from "../../db/schema";
import { ScanRepository } from "../scans/repositories";
import { buildStaticIntelligenceGeneration } from "./build-service";
import { staticIntelligenceMcpToolRegistry } from "./mcp-tools";
import { StaticIntelligencePrepareRepository } from "./prepare-repository";
import {
	getProjectIntelligenceStatus,
	prepareProjectIntelligence,
} from "./prepare-service";
import { processStaticIntelligencePrepareJob } from "./prepare-worker";
import {
	canonicalizeProjectPath,
} from "./project-path-resolver";
import { computeProjectSourceFingerprint } from "./project-source-fingerprint";

describe("projectPath-first Static Intelligence MCP", () => {
	let connection: DbConnection;
	let tempDir: string;
	let projectDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "path-first-mcp-"));
		projectDir = path.join(tempDir, "project");
		await fs.mkdir(path.join(projectDir, ".git"), { recursive: true });
		await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(projectDir, "src", "app.ts"),
			"export const app = true;\n",
		);
		projectDir = await fs.realpath(projectDir);
		process.env.SCAN_ARTIFACT_ROOT = path.join(tempDir, "artifacts");
		connection = createDbConnection(":memory:");
		applyMigrations(connection);
	});

	afterEach(async () => {
		connection.sqlite.close();
		delete process.env.SCAN_ARTIFACT_ROOT;
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("normalizes dot segments, rejects symlink aliases and unsafe paths, and keeps queries read-only", async () => {
		const alias = path.join(tempDir, "project-link");
		await fs.symlink(projectDir, alias);
		expect(
			await canonicalizeProjectPath({
				projectPath: `${projectDir}${path.sep}.`,
				allowedProjectRoots: [tempDir],
			}),
		).toBe(projectDir);
		await expect(
			canonicalizeProjectPath({
				projectPath: alias,
				allowedProjectRoots: [tempDir],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_SYMLINK_NOT_ALLOWED" });
		await expect(
			canonicalizeProjectPath({
				projectPath: "relative/project",
				allowedProjectRoots: [tempDir],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ABSOLUTE" });
		await expect(
			canonicalizeProjectPath({
				projectPath: projectDir,
				allowedProjectRoots: [],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });

		const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "path-first-outside-"));
		try {
			const outsideRepo = path.join(outsideRoot, "repo");
			await fs.mkdir(path.join(outsideRepo, ".git"), { recursive: true });
			const escape = path.join(tempDir, "escape");
			await fs.symlink(outsideRepo, escape);
			await expect(
				canonicalizeProjectPath({
					projectPath: escape,
					allowedProjectRoots: [tempDir],
				}),
			).rejects.toMatchObject({ code: "PROJECT_PATH_SYMLINK_NOT_ALLOWED" });
		} finally {
			await fs.rm(outsideRoot, { recursive: true, force: true });
		}

		const before = tableCounts(connection);
		const status = await getProjectIntelligenceStatus({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		expect(status).toMatchObject({
			ok: false,
			status: "not_prepared",
			errorCode: "PROJECT_NOT_PREPARED",
		});
		expect(tableCounts(connection)).toEqual(before);
	});

	it("creates one durable job and scan for duplicate prepare requests", async () => {
		const first = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		const second = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: path.join(projectDir, "."),
			allowedProjectRoots: [tempDir],
		});
		expect(first).toMatchObject({ ok: true, status: "queued" });
		expect(second).toMatchObject({ ok: true, status: "queued" });
		expect(second.provenance?.prepareJobId).toBe(
			first.provenance?.prepareJobId,
		);
		expect(count(connection, "projects")).toBe(1);
		expect(count(connection, "scan_runs")).toBe(1);
		expect(count(connection, "static_intelligence_prepare_jobs")).toBe(1);
	});

	it("keeps project creation under server policy control", async () => {
		const prepareTool = tool("vuln_prepare_project_intelligence");
		const rejected = await prepareTool.handler({
			db: connection.db,
			input: { projectPath: projectDir },
			allowedProjectRoots: [tempDir],
			projectCreationPolicy: "registered_only",
		});
		expect(rejected).toMatchObject({
			ok: false,
			status: "not_prepared",
			errorCode: "PROJECT_NOT_REGISTERED",
			retryable: false,
		});
		expect(count(connection, "projects")).toBe(0);

		const allowed = await prepareTool.handler({
			db: connection.db,
			input: { projectPath: projectDir },
			allowedProjectRoots: [tempDir],
			projectCreationPolicy: "create_within_allowed_roots",
		});
		expect(allowed).toMatchObject({ ok: true, status: "queued" });
		expect(count(connection, "projects")).toBe(1);
	});

	it("runs a claimed job to ready and safely retries after source changes", async () => {
		const queued = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		const jobId = queued.provenance?.prepareJobId;
		if (!jobId) throw new Error("prepare job missing");
		const ready = await processStaticIntelligencePrepareJob({
			db: connection.db,
			jobId,
			buildRunner: async () =>
				({ generationId: "11111111-1111-4111-8111-111111111111" }) as never,
		});
		expect(ready).toMatchObject({ ok: true, status: "ready" });
		expect(await new StaticIntelligencePrepareRepository(connection.db).findById(jobId)).toMatchObject({
			status: "ready",
			stage: "complete",
			attemptCount: 1,
		});

		await fs.writeFile(path.join(projectDir, "src", "app.ts"), "export const app = false;\n");
		const retry = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		expect(retry).toMatchObject({ ok: true, status: "queued" });
		expect(retry.provenance?.prepareJobId).not.toBe(jobId);
		const retryJobId = retry.provenance?.prepareJobId;
		if (!retryJobId) throw new Error("retry job missing");
		await new StaticIntelligencePrepareRepository(connection.db).update(
			retryJobId,
			{
				status: "running",
				stage: "security_scan",
				leaseExpiresAt: new Date(Date.now() - 1),
			},
		);
		const recovered = await processStaticIntelligencePrepareJob({
			db: connection.db,
			jobId: retryJobId,
			buildRunner: async () =>
				({ generationId: "22222222-2222-4222-8222-222222222222" }) as never,
		});
		expect(recovered).toMatchObject({ ok: true, status: "ready" });
		expect(
			(await new StaticIntelligencePrepareRepository(connection.db).findById(
				retryJobId,
			))?.attemptCount,
		).toBe(1);
	});

	it("does not publish a generation when source changes during its build", async () => {
		const queued = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		const jobId = queued.provenance?.prepareJobId;
		if (!jobId) throw new Error("prepare job missing");
		const result = await processStaticIntelligencePrepareJob({
			db: connection.db,
			jobId,
			buildRunner: async () => {
				await fs.writeFile(
					path.join(projectDir, "src", "app.ts"),
					"export const app = 'changed-during-build';\n",
				);
				return {
					generationId: "33333333-3333-4333-8333-333333333333",
				} as never;
			},
		});
		expect(result).toMatchObject({ ok: false, status: "failed" });
		expect(
			await new StaticIntelligencePrepareRepository(connection.db).findById(
				jobId,
			),
		).toMatchObject({ status: "failed", errorCode: "SOURCE_CHANGED" });
	});

	it("uses structure-only preparation without external security scanners", async () => {
		const queued = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		const jobId = queued.provenance?.prepareJobId;
		const scanRunId = queued.provenance?.scanRunId;
		if (!jobId || !scanRunId) throw new Error("prepare provenance missing");

		const result = await processStaticIntelligencePrepareJob({
			db: connection.db,
			jobId,
		});
		expect(result).toMatchObject({ ok: true, status: "ready" });
		const scan = connection.sqlite
			.query("select profile, status, metadata from scan_runs where id = ?1")
			.get(scanRunId) as { profile: string; status: string; metadata: string };
		expect(scan.profile).toBe("static-intelligence-structure-v1");
		expect(scan.status).toBe("completed");
		expect(
			connection.sqlite
				.query("select started_at as startedAt from scan_runs where id = ?1")
				.get(scanRunId),
		).toMatchObject({ startedAt: expect.any(Number) });
		expect(JSON.parse(scan.metadata)).toMatchObject({
			preparationMode: "structure_only",
			externalSecurityScannersExecuted: false,
		});
	});

	it("serves snapshot, catalog, and manifest by path without query mutations", async () => {
		const queued = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		const jobId = queued.provenance?.prepareJobId;
		const scanRunId = queued.provenance?.scanRunId;
		if (!jobId || !scanRunId) throw new Error("prepare provenance missing");
		connection.sqlite
			.query("update scan_runs set status = 'completed', completed_at = ?1 where id = ?2")
			.run(Date.now(), scanRunId);
		const generation = await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId,
		});
		await new StaticIntelligencePrepareRepository(connection.db).update(jobId, {
			status: "ready",
			stage: "complete",
			generationId: generation.generationId,
			completedAt: new Date(),
		});
		const reusedBefore = tableCounts(connection);
		const reused = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		expect(reused).toMatchObject({ ok: true, status: "ready", reused: true });
		expect(tableCounts(connection)).toEqual(reusedBefore);

		const projectId = queued.provenance?.projectId;
		if (!projectId) throw new Error("project provenance missing");
		await connection.db.insert(findings).values([
			findingRow(projectId, scanRunId, "duplicate-fingerprint", "rule-a"),
			findingRow(projectId, scanRunId, "duplicate-fingerprint", "rule-b"),
		]);

		const before = tableCounts(connection);
		const snapshot = await tool("vuln_get_code_structure_snapshot").handler({
			db: connection.db,
			input: { projectPath: projectDir },
			allowedProjectRoots: [tempDir],
		});
		const catalog = await tool("vuln_get_project_exploration_catalog").handler({
			db: connection.db,
			input: { projectPath: projectDir },
			allowedProjectRoots: [tempDir],
		});
		const manifest = await tool("vuln_get_knowledge_source_manifest").handler({
			db: connection.db,
			input: { projectPath: projectDir },
			allowedProjectRoots: [tempDir],
		});
		const ambiguous = await tool("vuln_get_evidence_bundle").handler({
			db: connection.db,
			input: {
				projectPath: projectDir,
				findingFingerprint: "duplicate-fingerprint",
			},
			allowedProjectRoots: [tempDir],
		});
		expect(ambiguous).toMatchObject({
			ok: false,
			status: "failed",
			errorCode: "AMBIGUOUS_FINDING",
			retryable: false,
		});
		for (const result of [snapshot, catalog, manifest]) {
			expect(result).toMatchObject({
				ok: true,
				projectPath: projectDir,
				freshness: { status: "fresh" },
			});
			const { provenance: _provenance, ...publicResult } = result as Record<
				string,
				unknown
			>;
			const serializedPublicResult = JSON.stringify(publicResult);
			expect(serializedPublicResult).not.toContain(projectId);
			expect(serializedPublicResult).not.toContain(scanRunId);
			expect(serializedPublicResult).not.toContain(generation.generationId);
		}
		expect(tableCounts(connection)).toEqual(before);
		await fs.writeFile(
			path.join(projectDir, "src", "app.ts"),
			"export const app = 'changed';\n",
		);
		const staleStatus = await getProjectIntelligenceStatus({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		expect(staleStatus).toMatchObject({ ok: true, status: "stale" });
		const staleSnapshot = await tool("vuln_get_code_structure_snapshot").handler({
			db: connection.db,
			input: { projectPath: projectDir },
			allowedProjectRoots: [tempDir],
		});
		expect(staleSnapshot).toMatchObject({
			ok: true,
			freshness: { status: "stale" },
		});

		const rejected = await tool("vuln_get_code_structure_snapshot").handler({
			db: connection.db,
			input: { projectPath: projectDir, projectId: "internal-id" },
			allowedProjectRoots: [tempDir],
		});
		expect(rejected).toMatchObject({ ok: false, status: "failed" });
	});

	it("reads the exact generation selected by current-source readiness", async () => {
		const queued = await prepareProjectIntelligence({
			db: connection.db,
			projectPath: projectDir,
			allowedProjectRoots: [tempDir],
		});
		const jobId = queued.provenance?.prepareJobId;
		const scanRunId = queued.provenance?.scanRunId;
		const projectId = queued.provenance?.projectId;
		if (!jobId || !scanRunId || !projectId) {
			throw new Error("prepare provenance missing");
		}
		await new ScanRepository(connection.db).updateScanRunStatus(
			scanRunId,
			"completed",
		);
		const selectedGeneration = await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId,
		});
		await new StaticIntelligencePrepareRepository(connection.db).update(jobId, {
			status: "ready",
			stage: "complete",
			generationId: selectedGeneration.generationId,
			completedAt: new Date(),
		});

		const unrelatedScan = await new ScanRepository(connection.db).createScanRun({
			projectId,
			profile: "static-intelligence-structure-v1",
			status: "completed",
		});
		const newerGeneration = await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId: unrelatedScan.id,
		});
		expect(newerGeneration.generationId).not.toBe(
			selectedGeneration.generationId,
		);

		const catalog = await tool("vuln_get_project_exploration_catalog").handler({
			db: connection.db,
			input: { projectPath: projectDir },
			allowedProjectRoots: [tempDir],
		});
		expect(catalog).toMatchObject({
			ok: true,
			freshness: { status: "fresh" },
			provenance: {
				scanRunId,
				generationId: selectedGeneration.generationId,
			},
		});
	});

	it("produces deterministic source fingerprints and detects changes", async () => {
		const first = await computeProjectSourceFingerprint(projectDir);
		const second = await computeProjectSourceFingerprint(projectDir);
		expect(second).toEqual(first);
		await fs.writeFile(path.join(projectDir, "src", "new.ts"), "export const n = 1;\n");
		const changed = await computeProjectSourceFingerprint(projectDir);
		expect(changed.value).not.toBe(first.value);
	});
});

function tool(name: string) {
	const definition = staticIntelligenceMcpToolRegistry.find(
		(candidate) => candidate.name === name,
	);
	if (!definition) throw new Error(`tool missing: ${name}`);
	return definition;
}

function tableCounts(connection: DbConnection) {
	return {
		projects: count(connection, "projects"),
		scanRuns: count(connection, "scan_runs"),
		prepareJobs: count(connection, "static_intelligence_prepare_jobs"),
		findings: count(connection, "findings"),
		generations: count(
			connection,
			"scan_artifacts",
			"where kind in ('code_structure_snapshot', 'static_intelligence_export')",
		),
	};
}

function findingRow(
	projectId: string,
	scanRunId: string,
	fingerprint: string,
	ruleId: string,
) {
	return {
		scanRunId,
		projectId,
		sourceTool: "semgrep",
		ruleId,
		title: ruleId,
		description: "duplicate fixture",
		severity: "medium",
		confidence: "high",
		status: "open",
		primaryLocation: { path: "src/app.ts" },
		fingerprint,
		metadata: {},
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function count(connection: DbConnection, table: string, suffix = "") {
	return (
		connection.sqlite
			.query(`select count(*) as count from ${table} ${suffix}`)
			.get() as { count: number }
	).count;
}

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b))) {
		connection.sqlite.exec(
			readFileSync(path.join(migrationsDir, filename), "utf8"),
		);
	}
}
