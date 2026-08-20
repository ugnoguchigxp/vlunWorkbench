import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { ProfileToolEntry } from "../../../shared/schemas/scan-profile.schema";
import { createDbConnection, type DbConnection } from "../../db";
import { scanArtifacts, toolRuns, users } from "../../db/schema";
import { ArtifactRepository } from "../scans/artifact-repository";
import { ArtifactStorage } from "../scans/artifact-storage";
import { buildDiffScanPlan, canonicalJson } from "../scans/diff-scan-plan";
import type { ResolvedGitDiff } from "../scans/git-diff-resolver";
import { persistedTargetMetadata } from "../scans/profile-runner";
import {
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "../scans/repositories";
import {
	buildPersistedDependencyAssessment,
	SecurityAssessmentInputError,
} from "./security-assessment-service";

const completedAt = new Date("2026-08-15T06:00:00.000Z");
const generatedAt = new Date("2026-08-15T06:01:00.000Z");
describe("persisted dependency assessment service", () => {
	let connection: DbConnection;
	let artifactRoot: string;
	let storage: ArtifactStorage;
	let ownerUserId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		migrate(connection);
		artifactRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "security-assessment-"),
		);
		storage = new ArtifactStorage(artifactRoot);
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "security-assessment@example.com",
				passwordHash: "hash",
				displayName: "Security Assessment",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		ownerUserId = user.id;
	});

	afterEach(async () => {
		connection.sqlite.close();
		await fs.rm(artifactRoot, { recursive: true, force: true });
	});

	it("builds a deterministic no-findings assessment from persisted evidence", async () => {
		const fixture = await seedPersistedScan({ status: "completed" });
		const first = await assess(fixture.scanRunId, {
			expectedProjectId: fixture.projectId,
			ownerUserId,
			expectedSourceRevision: fixture.sourceRevision,
		});
		const second = await buildPersistedDependencyAssessment({
			db: connection.db,
			artifactStorage: storage,
			request: {
				scanRunId: fixture.scanRunId,
				generatedAt: new Date("2026-08-15T06:02:00.000Z"),
			},
		});

		expect(first.outcome).toBe("no_findings_observed");
		expect(first.assessmentRef).toBe(second.assessmentRef);
		expect(first.verifications[0]).toMatchObject({
			status: "tested",
			findingRefs: [],
		});
		expect(JSON.stringify(first)).not.toContain(artifactRoot);
	});

	it("links persisted dependency findings to their tool verification", async () => {
		const fixture = await seedPersistedScan({
			status: "completed",
			withFinding: true,
		});
		const assessment = await assess(fixture.scanRunId);

		expect(assessment.outcome).toBe("findings_observed");
		expect(assessment.findingRefs).toHaveLength(1);
		expect(assessment.verifications[0]?.findingRefs).toEqual(
			assessment.findingRefs,
		);
		expect(
			assessment.evidenceRefs.find(
				(evidence) => evidence.ref === assessment.findingRefs[0],
			)?.kind,
		).toBe("finding");
	});

	it("projects Trivy dependency findings without reading raw bodies", async () => {
		const fixture = await seedPersistedScan({
			status: "completed",
			toolId: "trivy",
			withFinding: true,
		});
		const assessment = await assess(fixture.scanRunId);

		expect(assessment.outcome).toBe("findings_observed");
		expect(assessment.verifications[0]?.capabilityRef).toBe(
			"dependency-vulnerability:trivy",
		);
		expect(JSON.stringify(assessment)).not.toContain("RAW_PRIVATE_BODY");
	});

	it("keeps a failed dependency tool inconclusive", async () => {
		const fixture = await seedPersistedScan({ status: "failed" });
		const assessment = await assess(fixture.scanRunId);

		expect(assessment.outcome).toBe("inconclusive");
		expect(assessment.verifications[0]?.status).toBe("failed");
		expect(assessment.coverage.limitationCodes).toContain(
			"tool_execution_failed",
		);
		expect(JSON.stringify(assessment)).not.toContain("api_key=private");
	});

	it("does not turn a missing applicable tool result into a zero-findings claim", async () => {
		const fixture = await seedPersistedScan({
			status: "completed",
			omitToolResult: true,
		});
		const assessment = await assess(fixture.scanRunId);

		expect(assessment.outcome).toBe("unavailable");
		expect(assessment.verifications[0]).toMatchObject({
			required: true,
			status: "unavailable",
			reasonCode: "dependency_tool_result_missing",
		});
	});

	it("represents a non-dependency diff as not applicable", async () => {
		const fixture = await seedPersistedScan({
			status: "skipped",
			changedPath: "src/app.ts",
		});
		const assessment = await assess(fixture.scanRunId);

		expect(assessment.outcome).toBe("inconclusive");
		expect(assessment.claims).toEqual([]);
		expect(assessment.verifications[0]).toMatchObject({
			required: false,
			status: "not_applicable",
		});
	});

	it("supports a SHA-256 working-tree target within the revision contract", async () => {
		const fixture = await seedPersistedScan({
			status: "completed",
			workingTree: true,
			shaLength: 64,
		});
		const assessment = await assess(fixture.scanRunId);

		expect(assessment.target.sourceRevision).toBe(
			`working-tree/${assessment.target.targetDigest.slice("sha256:".length)}`,
		);
	});

	it.each([
		["project_binding_mismatch", { expectedProjectId: "project:wrong" }],
		["project_owner_mismatch", { ownerUserId: "user:wrong" }],
		[
			"source_revision_mismatch",
			{ expectedSourceRevision: "c".repeat(40) },
		],
	] as const)("rejects %s", async (code, request) => {
		const fixture = await seedPersistedScan({ status: "completed" });
		await expect(assess(fixture.scanRunId, request)).rejects.toMatchObject({
			code,
		} satisfies Partial<SecurityAssessmentInputError>);
	});

	it("rejects artifact content drift", async () => {
		const fixture = await seedPersistedScan({ status: "completed" });
		await connection.db
			.update(scanArtifacts)
			.set({ sha256: "0".repeat(64) })
			.where(eq(scanArtifacts.id, fixture.manifestArtifactId));

		await expect(assess(fixture.scanRunId)).rejects.toMatchObject({
			code: "diff_manifest_digest_mismatch",
		});
	});

	it("rejects a re-signed manifest with inconsistent coverage", async () => {
		const fixture = await seedPersistedScan({ status: "completed" });
		const manifestText = await storage.readTextArtifact(fixture.manifestPath);
		const manifest = JSON.parse(manifestText);
		manifest.coverage.changed = 2;
		const alteredManifest = `${canonicalJson(manifest)}\n`;
		await fs.writeFile(
			path.resolve(artifactRoot, fixture.manifestPath),
			alteredManifest,
		);
		const saved = {
			sha256: createHash("sha256").update(alteredManifest).digest("hex"),
			sizeBytes: Buffer.byteLength(alteredManifest, "utf8"),
		};
		await connection.db
			.update(scanArtifacts)
			.set({ sha256: saved.sha256, sizeBytes: saved.sizeBytes })
			.where(eq(scanArtifacts.id, fixture.manifestArtifactId));

		await expect(assess(fixture.scanRunId)).rejects.toMatchObject({
			code: "diff_manifest_coverage_mismatch",
		});
	});

	it("rejects referenced tool artifact content drift", async () => {
		const fixture = await seedPersistedScan({ status: "completed" });
		if (!fixture.rawArtifactId) throw new Error("Raw artifact fixture missing");
		await connection.db
			.update(scanArtifacts)
			.set({ sha256: "0".repeat(64) })
			.where(eq(scanArtifacts.id, fixture.rawArtifactId));

		await expect(assess(fixture.scanRunId)).rejects.toMatchObject({
			code: "tool_artifact_digest_mismatch",
		});
	});

	it("rejects a persisted finding count that differs from bound findings", async () => {
		const fixture = await seedPersistedScan({
			status: "completed",
			reportedFindingCount: 1,
		});

		await expect(assess(fixture.scanRunId)).rejects.toMatchObject({
			code: "tool_result_finding_count_mismatch",
		});
	});

	it("rejects tool-run target drift", async () => {
		const fixture = await seedPersistedScan({ status: "completed" });
		if (!fixture.toolRunId) throw new Error("Tool run fixture missing");
		await connection.db
			.update(toolRuns)
			.set({ metadata: { scanTarget: { targetDigest: "0".repeat(64) } } })
			.where(eq(toolRuns.id, fixture.toolRunId));

		await expect(assess(fixture.scanRunId)).rejects.toMatchObject({
			code: "tool_run_target_mismatch",
		});
	});

	async function assess(
		scanRunId: string,
		request: {
			expectedProjectId?: string;
			ownerUserId?: string;
			expectedSourceRevision?: string;
		} = {},
	) {
		return await buildPersistedDependencyAssessment({
			db: connection.db,
			artifactStorage: storage,
			request: { scanRunId, generatedAt, ...request },
		});
	}

	async function seedPersistedScan(options: {
		status: "completed" | "failed" | "skipped";
		changedPath?: string;
		toolId?: "osv" | "trivy";
		withFinding?: boolean;
		omitToolResult?: boolean;
		reportedFindingCount?: number;
		workingTree?: boolean;
		shaLength?: 40 | 64;
	}) {
		const toolId = options.toolId ?? "osv";
		const projectRepo = new ProjectRepository(connection.db);
		const scanRepo = new ScanRepository(connection.db);
		const artifactRepo = new ArtifactRepository(connection.db);
		const findingRepo = new FindingRepository(connection.db);
		const project = await projectRepo.createProject({
			ownerUserId,
			name: "fixture-project",
			repoPath: "/fixture/project",
		});
		const plan = buildDiffScanPlan({
			resolved: resolved(options.changedPath ?? "package-lock.json", {
				workingTree: options.workingTree,
				shaLength: options.shaLength,
			}),
			tools: [dependencyTool(toolId)],
			projectInventoryPaths: [options.changedPath ?? "package-lock.json"],
		});
		const scan = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "diff-basic-security",
			status: "running",
			createdByUserId: ownerUserId,
		});
		const savedManifest = await storage.saveTextArtifact(
			scan.id,
			"manifests",
			`${canonicalJson(plan.manifest)}\n`,
			"diff-manifest.json",
		);
		const manifestArtifact = await artifactRepo.createArtifact({
			scanRunId: scan.id,
			toolRunId: null,
			kind: "diff_manifest",
			format: "json",
			path: savedManifest.path,
			sha256: savedManifest.sha256,
			sizeBytes: savedManifest.sizeBytes,
			metadata: { targetDigest: plan.target.targetDigest },
		});

		let toolRunId: string | null = null;
		let rawArtifactId: string | null = null;
		let artifactIds: string[] = [];
		if (options.status !== "skipped") {
			const toolRun = await scanRepo.createToolRun({
				scanRunId: scan.id,
				toolName: toolId,
				toolVersion: "2.0.0",
				status: "running",
				metadata: {
					scanTarget: persistedTargetMetadata(plan.target),
					error: "api_key=private from /Users/example/repository",
				},
			});
			toolRunId = toolRun.id;
			await scanRepo.updateToolRunStatus(toolRun.id, options.status, {
				exitCode: options.status === "completed" ? 0 : 1,
				completedAt,
				metadata: {
					scanTarget: persistedTargetMetadata(plan.target),
					error: "api_key=private from /Users/example/repository",
				},
			});
			const savedRaw = await storage.saveTextArtifact(
				scan.id,
				"raw",
				'{"body":"RAW_PRIVATE_BODY"}\n',
				`${toolId}.json`,
			);
			const rawArtifact = await artifactRepo.createArtifact({
				scanRunId: scan.id,
				toolRunId: toolRun.id,
				kind: "raw_result",
				format: "json",
				path: savedRaw.path,
				sha256: savedRaw.sha256,
				sizeBytes: savedRaw.sizeBytes,
			});
			rawArtifactId = rawArtifact.id;
			artifactIds = [rawArtifact.id];
		}

		if (options.withFinding) {
			await findingRepo.createFinding({
				scanRunId: scan.id,
				projectId: project.id,
				sourceTool: toolId,
				ruleId: "OSV-FIXTURE-1",
				title: "Fixture dependency finding",
				description: "Fixture description",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "package-lock.json" },
				fingerprint: "fixture-fingerprint",
				metadata: {
					scanTarget: persistedTargetMetadata(plan.target),
					diffRelation: { kind: "target_state_dependency" },
				},
			});
		}

		const applicability = plan.tools.find((tool) => tool.toolId === toolId);
		if (!applicability) throw new Error("Tool applicability fixture missing");
		await scanRepo.updateScanRunStatus(scan.id, "completed", {
			completedAt,
			metadata: {
				target: plan.target,
				diffManifestArtifactId: manifestArtifact.id,
				diffToolApplicability: plan.tools,
				toolResults: options.omitToolResult
					? []
					: [{
						toolId,
						toolRunId,
						required: true,
						status: options.status,
						findingCount:
							options.reportedFindingCount ?? (options.withFinding ? 1 : 0),
						applicability: applicability.applicability,
						reasonCode: applicability.reasonCode,
						coverageEffect: applicability.coverageEffect,
						artifactIds,
						},
					],
			},
		});
		return {
			projectId: project.id,
			scanRunId: scan.id,
			manifestArtifactId: manifestArtifact.id,
			manifestPath: manifestArtifact.path,
			rawArtifactId,
			sourceRevision: plan.target.headSha ?? "",
			toolRunId,
		};
	}
});

function migrate(connection: DbConnection): void {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort()) {
		connection.sqlite.exec(
			readFileSync(path.join(migrationsDir, filename), "utf8"),
		);
	}
}

function dependencyTool(toolId: "osv" | "trivy"): ProfileToolEntry {
	return {
		toolId,
		displayName: toolId === "osv" ? "OSV" : "Trivy",
		required: true,
		failurePolicy: "fail_profile",
	};
}


function resolved(
	pathValue: string,
	options: { workingTree?: boolean; shaLength?: 40 | 64 } = {},
): ResolvedGitDiff {
	const shaLength = options.shaLength ?? 40;
	return {
		gitRoot: "/fixture",
		projectRoot: "/fixture",
		projectPrefix: "",
		requested: options.workingTree
			? { kind: "working_tree", base: "HEAD", includeUntracked: false }
			: { kind: "range", base: "base", head: "head" },
		baseSha: "a".repeat(shaLength),
		headSha: options.workingTree ? null : "b".repeat(shaLength),
		mergeBaseSha: "a".repeat(shaLength),
		includeUntracked: false,
		entries: [
			{
				status: "modified",
				path: pathValue,
				contentSha256: "c".repeat(64),
				sizeBytes: 10,
				binary: false,
				inProfileScope: true,
				disposition: "scan",
				reasonCode: null,
			},
		],
	};
}
