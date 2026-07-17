import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	projectExplorationCatalogInputSchema,
	projectExplorationCatalogResultSchema,
	projectExplorationSourceRevisionSchema,
} from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import { createDbConnection, type DbConnection } from "../../db";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanReviews,
	scanRuns,
	toolRuns,
	users,
} from "../../db/schema";
import { runStaticIntelligenceAgentQuery } from "./agent-query";
import { buildStaticIntelligenceGeneration } from "./build-service";
import { StaticIntelligenceGenerationRepository } from "./generation-repository";
import { buildStaticIntelligenceGuardrailMaterial } from "./guardrail-material";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "./knowledge-source-manifest";
import {
	getProjectExplorationCatalogTool,
	getStaticIntelligenceCodeStructureSnapshotTool,
	getStaticIntelligenceProjectStructureSnapshotTool,
	getStaticIntelligenceEvidenceBundleTool,
	getStaticIntelligenceGuardrailMaterialTool,
	getStaticIntelligenceKnowledgeSourceManifestTool,
	getStaticIntelligenceVerificationCommandsTool,
	listStaticIntelligenceKnowledgeSources,
	staticIntelligenceMcpToolRegistry,
} from "./mcp-tools";

const NOW = new Date("2026-07-06T10:00:00.000Z");
const GENERATED_AT = new Date("2026-07-06T10:30:00.000Z");
const RAW_SNIPPET_MARKER = "SECRET_RAW_SNIPPET_SHOULD_NOT_LEAK";
const RAW_ARTIFACT_MARKER = "SECRET_RAW_ARTIFACT_SHOULD_NOT_LEAK";
const SECRET_MARKER = "SECRET_TOKEN_SHOULD_NOT_LEAK";
let REPO_PATH_MARKER = "";

describe("Static Intelligence MCP tools", () => {
	let connection: DbConnection;
	let tempDir: string;
	let userId: string;
	let projectId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "static-intel-mcp-"));
		process.env.SCAN_ARTIFACT_ROOT = path.join(tempDir, "artifacts");
		REPO_PATH_MARKER = path.join(tempDir, "private-repo");
		await fs.mkdir(path.join(REPO_PATH_MARKER, "src"), { recursive: true });
		await fs.writeFile(path.join(REPO_PATH_MARKER, "src", "app.ts"), "export const app = true;\n");
		connection = createDbConnection(":memory:");
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "static-intel-mcp@example.com",
				passwordHash: "password",
				displayName: "Static Intel MCP User",
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
				name: "Target Project",
				repoPath: REPO_PATH_MARKER,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		projectId = project.id;
	});

	it("validates bounded project exploration catalog schemas", () => {
		const base = {
			scanRunId: "scan-1",
			generationId: "00000000-0000-4000-8000-000000000001",
		};
		for (const focus of [
			{ paths: ["api/routes/app.ts"] },
			{ moduleIds: ["module:abc"] },
			{ terms: ["routes"] },
		]) {
			expect(
				projectExplorationCatalogInputSchema.safeParse({ ...base, focus }).success,
			).toBe(true);
		}
		expect(
			projectExplorationCatalogInputSchema.safeParse({ ...base, focus: {} })
				.success,
		).toBe(false);
		for (const invalidPath of [
			"/tmp/x",
			"C:\\x",
			"../x",
			"a/../x",
			"a\\b",
			"a\0b",
		]) {
			expect(
				projectExplorationCatalogInputSchema.safeParse({
					...base,
					focus: { paths: [invalidPath] },
				}).success,
			).toBe(false);
		}
		for (const invalidInput of [
			{ ...base, scanRunId: "s".repeat(257), focus: { terms: ["api"] } },
			{ ...base, focus: { paths: ["p".repeat(1025)] } },
			{ ...base, focus: { moduleIds: ["m".repeat(257)] } },
		]) {
			expect(projectExplorationCatalogInputSchema.safeParse(invalidInput).success).toBe(
				false,
			);
		}
		for (const limits of [
			{ files: 21 },
			{ tests: 11 },
			{ verificationCommands: 7 },
		]) {
			expect(
				projectExplorationCatalogInputSchema.safeParse({
					...base,
					focus: { terms: ["api"] },
					limits,
				}).success,
			).toBe(false);
		}
		expect(
			projectExplorationCatalogInputSchema.safeParse({
				...base,
				focus: { terms: ["api"], unknown: true },
			}).success,
		).toBe(false);
		expect(
			projectExplorationSourceRevisionSchema.safeParse({
				kind: "git",
				value: "abc123",
			}).success,
		).toBe(false);
		expect(
			projectExplorationSourceRevisionSchema.safeParse({
				kind: "tree_hash_only",
				value: "a".repeat(64),
			}).success,
		).toBe(true);

		const topLevelKeys = Object.keys(projectExplorationCatalogResultSchema.shape);
		for (const forbidden of ["content", "body", "snippet", "rootPath", "repoPath"]) {
			expect(topLevelKeys).not.toContain(forbidden);
		}
	});

	afterEach(async () => {
		connection.sqlite.close();
		delete process.env.SCAN_ARTIFACT_ROOT;
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("registers the expected action and read-only tool surface", () => {
		expect(staticIntelligenceMcpToolRegistry.map((tool) => tool.name)).toEqual([
			"vuln_prepare_project_intelligence",
			"vuln_get_project_intelligence_status",
			"vuln_list_knowledge_sources",
			"vuln_get_knowledge_source_manifest",
			"vuln_get_guardrail_material",
			"vuln_get_evidence_bundle",
			"vuln_get_verification_commands",
			"vuln_get_code_structure_snapshot",
			"vuln_get_project_structure_snapshot",
			"vuln_get_project_exploration_catalog",
		]);
		expect(
			staticIntelligenceMcpToolRegistry.map((tool) => ({
				name: tool.name,
				readOnlyHint: tool.readOnlyHint,
			})),
		).toEqual([
			{ name: "vuln_prepare_project_intelligence", readOnlyHint: false },
			...staticIntelligenceMcpToolRegistry.slice(1).map((tool) => ({
				name: tool.name,
				readOnlyHint: true,
			})),
		]);
		expect(
			staticIntelligenceMcpToolRegistry.slice(1).every((tool) =>
				tool.description.toLowerCase().includes("read-only"),
			),
		).toBe(true);
		const pathInputs: Record<string, Record<string, unknown>> = {
			vuln_prepare_project_intelligence: { projectPath: "/repo" },
			vuln_get_project_intelligence_status: { projectPath: "/repo" },
			vuln_get_knowledge_source_manifest: { projectPath: "/repo" },
			vuln_get_guardrail_material: { projectPath: "/repo" },
			vuln_get_evidence_bundle: {
				projectPath: "/repo",
				findingFingerprint: "fingerprint",
			},
			vuln_get_verification_commands: { projectPath: "/repo" },
			vuln_get_code_structure_snapshot: { projectPath: "/repo" },
			vuln_get_project_structure_snapshot: { projectPath: "/repo" },
			vuln_get_project_exploration_catalog: { projectPath: "/repo" },
		};
		for (const [name, input] of Object.entries(pathInputs)) {
			const definition = staticIntelligenceMcpToolRegistry.find(
				(tool) => tool.name === name,
			);
			expect(definition?.inputSchema.safeParse(input).success).toBe(true);
			expect(
				definition?.inputSchema.safeParse({ ...input, projectId: "internal" })
					.success,
			).toBe(false);
		}
	});

	it("fetches code structure snapshots through MCP without arbitrary path input", async () => {
		const repoPath = path.join(tempDir, "code-project");
		await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
		await fs.writeFile(
			path.join(repoPath, "src", "app.ts"),
			"export const app = true;\n",
			"utf8",
		);
		const codeProjectId = await seedProject("Code Project", repoPath);
		const scanRunId = await seedScanRun({ projectId: codeProjectId });
		await persistGeneration(scanRunId);

		const result = await getStaticIntelligenceCodeStructureSnapshotTool({
			db: connection.db,
			input: { scanRunId },
		});

		expect(result).toMatchObject({ ok: true, status: "completed" });
		if (!result.ok) throw new Error(result.message);
		expect(result.snapshot.project.id).toBe(codeProjectId);
		expect(result.snapshot.project.rootPath).toBeUndefined();
		expect(result.snapshot.files.map((file) => file.path)).toEqual([
			"src/app.ts",
		]);
		expect(result.generation?.generationId).toMatch(/^[0-9a-f-]{36}$/);
		await expect(
			getStaticIntelligenceCodeStructureSnapshotTool({
				db: connection.db,
				input: { scanRunId, generationId: "00000000-0000-4000-8000-000000000001" },
			}),
		).resolves.toMatchObject({ ok: false, status: "failed" });
	});

	it("fetches persisted Project Structure v2 through MCP", async () => {
		const repoPath = path.join(tempDir, "project-structure-project");
		await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
		await fs.writeFile(path.join(repoPath, "src", "app.ts"), 'import "./styles.css";\nexport const app = true;\n');
		await fs.writeFile(path.join(repoPath, "src", "styles.css"), ".app { color: red; }\n");
		const projectId = await seedProject("Project Structure Project", repoPath);
		await fs.writeFile(path.join(repoPath, "src", "app.ts"), 'import "./styles.css";\nexport const app = true;\n');
		await fs.writeFile(path.join(repoPath, "src", "styles.css"), ".app { color: red; }\n");
		const scanRunId = await seedScanRun({ projectId });
		await persistGeneration(scanRunId);

		const result = await getStaticIntelligenceProjectStructureSnapshotTool({
			db: connection.db,
			input: { scanRunId },
		});

		expect(result).toMatchObject({ ok: true, status: "completed", version: "v2", view: "summary" });
		if (!result.ok) throw new Error(result.message);
		expect(result.generation).toMatchObject({ generationId: expect.any(String) });
		const references = await getStaticIntelligenceProjectStructureSnapshotTool({
			db: connection.db,
			input: { scanRunId, view: "references", limit: 1 },
		});
		expect(references).toMatchObject({ ok: true, view: "references", total: expect.any(Number) });
		if (!references.ok) throw new Error(references.message);
		expect(references.items).toEqual(expect.arrayContaining([
			expect.objectContaining({ specifier: "./styles.css", status: "resolved", target: "src/styles.css" }),
		]));
	});

	it("returns failure JSON for invalid input and missing scans", async () => {
		await expect(
			listStaticIntelligenceKnowledgeSources({
				db: connection.db,
				input: { limit: 101 },
			}),
		).resolves.toMatchObject({ ok: false, status: "failed" });

		await expect(
			getProjectExplorationCatalogTool({
				db: connection.db,
				input: {
					scanRunId: "missing-scan",
					generationId: "00000000-0000-4000-8000-000000000001",
					focus: { terms: ["source"] },
				},
			}),
		).resolves.toMatchObject({
			ok: false,
			reasonCode: "generation_missing",
		});
		await expect(
			getProjectExplorationCatalogTool({
				db: connection.db,
				input: {
					scanRunId: "missing-scan",
					generationId: "00000000-0000-4000-8000-000000000001",
					focus: {},
				},
			}),
		).resolves.toMatchObject({
			ok: false,
			reasonCode: "focus_required",
		});

		await expect(
			getStaticIntelligenceKnowledgeSourceManifestTool({
				db: connection.db,
				input: { scanRunId: "missing-scan" },
			}),
		).resolves.toMatchObject({
			ok: false,
			status: "failed",
			message: "Static Intelligence generation missing.",
		});

		const damagedScanRunId = await seedScanRun();
		const damagedBuild = await persistGeneration(damagedScanRunId);
		const damaged = await new StaticIntelligenceGenerationRepository(
			connection.db,
		).loadGeneration(damagedScanRunId, damagedBuild.generationId);
		if (!damaged) throw new Error("expected damaged generation fixture");
		await fs.rm(
			path.resolve(
				process.env.SCAN_ARTIFACT_ROOT ?? "",
				damaged.structure.artifact.path,
			),
		);
		const damagedResult = await getProjectExplorationCatalogTool({
			db: connection.db,
			input: {
				scanRunId: damagedScanRunId,
				generationId: damaged.generationId,
				focus: { terms: ["source"] },
			},
		});
		expect(damagedResult).toMatchObject({
			ok: false,
			reasonCode: "catalog_unavailable",
			message: "Project exploration catalog unavailable.",
		});
		expect(JSON.stringify(damagedResult)).not.toContain(tempDir);

		const { scanRunId } = await seedFindingBackedScan();
		await persistGeneration(scanRunId);
		await expect(
			getStaticIntelligenceEvidenceBundleTool({
				db: connection.db,
				input: { scanRunId, findingId: "missing-finding" },
			}),
		).resolves.toMatchObject({
			ok: false,
			status: "failed",
			message: "Finding not found: missing-finding",
		});
	});

	it("lists recent knowledge sources newest first with bounded filtering", async () => {
		const olderScanRunId = await seedScanRun({
			updatedAt: new Date("2026-07-06T09:00:00.000Z"),
		});
		const { scanRunId: newerScanRunId } = await seedFindingBackedScan({
			updatedAt: new Date("2026-07-06T11:00:00.000Z"),
		});
		const otherProjectId = await seedProject("Other Project", path.join(tempDir, "other"));
		const otherScanRunId = await seedScanRun({
			projectId: otherProjectId,
			updatedAt: new Date("2026-07-06T12:00:00.000Z"),
		});
		await Promise.all([persistGeneration(olderScanRunId), persistGeneration(newerScanRunId), persistGeneration(otherScanRunId)]);

		const allResult = await listStaticIntelligenceKnowledgeSources({
			db: connection.db,
			input: { limit: 2 },
			generatedAt: GENERATED_AT,
		});
		expect(allResult).toMatchObject({ ok: true, status: "completed" });
		if (!allResult.ok) throw new Error(allResult.message);
		expect(allResult.sources.map((source) => source.scanRunId)).toEqual([
			otherScanRunId,
			newerScanRunId,
		]);
		expect(allResult.sources[0].command).toEqual([
			"bun",
			"run",
			"intelligence:knowledge-source",
			"--",
			"--scan-run-id",
			otherScanRunId,
			"--generation-id",
			allResult.sources[0].generationId,
		]);
		expect(JSON.stringify(allResult)).not.toContain(REPO_PATH_MARKER);
		expect(allResult.sources[0]).toMatchObject({
			rootRef: expect.stringMatching(/^[a-f0-9]{64}$/),
			generationGeneratedAt: expect.any(String),
			sourceRevision: { kind: "tree_hash_only" },
			readiness: expect.stringMatching(/^(available|stale|degraded)$/),
		});

		const filteredResult = await listStaticIntelligenceKnowledgeSources({
			db: connection.db,
			input: { projectId, limit: 10 },
			generatedAt: GENERATED_AT,
		});
		expect(filteredResult).toMatchObject({ ok: true });
		if (!filteredResult.ok) throw new Error(filteredResult.message);
		expect(filteredResult.sources.map((source) => source.scanRunId)).toEqual([
			newerScanRunId,
			olderScanRunId,
		]);
		const rootRef = createHash("sha256")
			.update(await fs.realpath(REPO_PATH_MARKER))
			.digest("hex");
		const rootFiltered = await listStaticIntelligenceKnowledgeSources({
			db: connection.db,
			input: { rootRef, limit: 10 },
			generatedAt: GENERATED_AT,
		});
		expect(rootFiltered).toMatchObject({ ok: true });
		if (!rootFiltered.ok) throw new Error(rootFiltered.message);
		expect(
			rootFiltered.sources.map((source) => source.scanRunId).sort(),
		).toEqual([newerScanRunId, olderScanRunId].sort());
		expect(
			await listStaticIntelligenceKnowledgeSources({
				db: connection.db,
				input: { rootRef, projectId: otherProjectId, limit: 10 },
				generatedAt: GENERATED_AT,
			}),
		).toMatchObject({ ok: true, sources: [] });
		expect(
			await listStaticIntelligenceKnowledgeSources({
				db: connection.db,
				input: { rootRef: "f".repeat(64), limit: 10 },
				generatedAt: GENERATED_AT,
			}),
		).toMatchObject({ ok: true, sources: [] });
	});

	it("returns a bounded catalog from one exact persisted generation", async () => {
		const repoPath = path.join(tempDir, "catalog-project");
		const catalogProjectId = await seedProject("Catalog Project", repoPath);
		const catalogScanRunId = await seedScanRun({ projectId: catalogProjectId });
		await persistGeneration(catalogScanRunId);
		const generation = await new StaticIntelligenceGenerationRepository(
			connection.db,
		).loadLatestValidGeneration(catalogScanRunId);
		if (!generation) throw new Error("expected catalog generation");
		const beforeCount = tableCount("scan_artifacts");
		const sourcePath = path.join(repoPath, "src", "app.ts");
		const beforeMtime = (await fs.stat(sourcePath)).mtimeMs;

		const result = await getProjectExplorationCatalogTool({
			db: connection.db,
			input: {
				scanRunId: catalogScanRunId,
				generationId: generation.generationId,
				focus: { paths: ["src/app.ts"] },
			},
		});
		expect(result).toMatchObject({
			ok: true,
			version: "v1",
			generation: {
				projectId: catalogProjectId,
				scanRunId: catalogScanRunId,
				generationId: generation.generationId,
				snapshotRef: generation.structure.metadata.snapshotRef,
				sourceTreeHash: generation.structure.metadata.sourceTreeHash,
				sourceStateHash: generation.structure.metadata.sourceStateHash,
			},
			likelyFiles: [{ rank: 1, path: "src/app.ts" }],
		});
		expect(JSON.stringify(result)).not.toContain(repoPath);
		expect(JSON.stringify(result)).not.toContain("export const app = true");
		expect(tableCount("scan_artifacts")).toBe(beforeCount);
		expect((await fs.stat(sourcePath)).mtimeMs).toBe(beforeMtime);
	});

	it("matches service output for manifest, guardrail material, evidence bundle, and verification commands", async () => {
		const { scanRunId, findingId } = await seedFindingBackedScan();
		await seedCompletedScanReview(scanRunId);
		await persistGeneration(scanRunId);

		const generation = await new StaticIntelligenceGenerationRepository(connection.db).loadLatestValidGeneration(scanRunId);
		if (!generation) throw new Error("expected persisted generation");
		const serviceManifest = buildStaticIntelligenceKnowledgeSourceManifest(
			generation.export.payload,
			{ generatedAt: GENERATED_AT, generation },
		);
		const manifestResult =
			await getStaticIntelligenceKnowledgeSourceManifestTool({
				db: connection.db,
				input: { scanRunId },
			});
		expect(manifestResult).toMatchObject({ ok: true });
		if (!manifestResult.ok) throw new Error(manifestResult.message);
		expect(manifestResult.manifest.source.contentHash).toBe(
			serviceManifest.source.contentHash,
		);
		expect(manifestResult.manifest.generation?.generationId).toBe(
			generation.generationId,
		);
		expect(manifestResult.manifest.source.exportHash).toBe(
			serviceManifest.source.exportHash,
		);
		expect(manifestResult.manifest.availableBundles).toEqual(
			serviceManifest.availableBundles,
		);

		const serviceMaterial = buildStaticIntelligenceGuardrailMaterial({
			exportPayload: generation.export.payload,
			sourceManifest: manifestResult.manifest,
			generatedAt: GENERATED_AT,
		});
		const materialResult = await getStaticIntelligenceGuardrailMaterialTool({
			db: connection.db,
			input: { scanRunId },
		});
		expect(materialResult).toMatchObject({ ok: true });
		if (!materialResult.ok) throw new Error(materialResult.message);
		expect(materialResult.sourceManifest).toEqual(serviceMaterial.sourceManifest);
		expect(materialResult.materials.map((material) => material.id)).toEqual(
			serviceMaterial.materials.map((material) => material.id),
		);

		const serviceEvidence = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "evidence_bundle",
				findingId,
				includeSemantic: false,
				includeCommunities: false,
				includeLandscape: false,
			},
			generatedAt: GENERATED_AT,
		});
		const evidenceResult = await getStaticIntelligenceEvidenceBundleTool({
			db: connection.db,
			input: { scanRunId, findingId },
		});
		expect(evidenceResult).toMatchObject({ ok: true });
		if (!evidenceResult.ok) throw new Error(evidenceResult.message);
		expect(evidenceResult.queryKind).toBe("evidence_bundle");
		expect(evidenceResult.refs).toEqual(serviceEvidence.refs);
		expect(evidenceResult.results.map((item) => item.id)).toEqual(
			serviceEvidence.results.map((item) => item.id),
		);

		const serviceCommands = await runStaticIntelligenceAgentQuery({
			db: connection.db,
			input: {
				scanRunId,
				queryKind: "verification_commands",
				includeSemantic: false,
				includeCommunities: false,
				includeLandscape: false,
			},
			generatedAt: GENERATED_AT,
		});
		const commandsResult =
			await getStaticIntelligenceVerificationCommandsTool({
				db: connection.db,
				input: { scanRunId },
			});
		expect(commandsResult).toMatchObject({ ok: true });
		if (!commandsResult.ok) throw new Error(commandsResult.message);
		expect(commandsResult.queryKind).toBe("verification_commands");
		expect(commandsResult.results).toEqual(serviceCommands.results);
		expect(
			commandsResult.results.every(
				(item) =>
					item.kind === "verification_command" &&
					item.candidateOnly &&
					item.findingIds.length === 0 &&
					item.evidenceRefs.length === 0 &&
					item.fileRefs.length === 0,
			),
		).toBe(true);
	});

	it("does not mutate storage while serving read-only tool calls", async () => {
		const { scanRunId, findingId } = await seedFindingBackedScan();
		await seedCompletedScanReview(scanRunId);
		await persistGeneration(scanRunId);
		const before = rowCounts();

		await listStaticIntelligenceKnowledgeSources({
			db: connection.db,
			input: { limit: 10 },
			generatedAt: GENERATED_AT,
		});
		await getStaticIntelligenceKnowledgeSourceManifestTool({
			db: connection.db,
			input: { scanRunId },
		});
		await getStaticIntelligenceGuardrailMaterialTool({
			db: connection.db,
			input: { scanRunId },
		});
		await getStaticIntelligenceEvidenceBundleTool({
			db: connection.db,
			input: { scanRunId, findingId },
		});
		await getStaticIntelligenceVerificationCommandsTool({
			db: connection.db,
			input: { scanRunId, findingId },
		});
		const generation = await new StaticIntelligenceGenerationRepository(
			connection.db,
		).loadLatestValidGeneration(scanRunId);
		if (!generation) throw new Error("expected persisted generation");
		await getProjectExplorationCatalogTool({
			db: connection.db,
			input: {
				scanRunId,
				generationId: generation.generationId,
				focus: { paths: ["src/app.ts"] },
			},
		});

		expect(rowCounts()).toEqual(before);
	});

	it("preserves redaction boundaries across all MCP outputs", async () => {
		const { scanRunId, findingId } = await seedFindingBackedScan({
			snippet: `${RAW_SNIPPET_MARKER} ${SECRET_MARKER}`,
			artifactMetadata: { rawContent: RAW_ARTIFACT_MARKER },
		});
		await seedCompletedScanReview(scanRunId);
		await persistGeneration(scanRunId);
		const generation = await new StaticIntelligenceGenerationRepository(
			connection.db,
		).loadLatestValidGeneration(scanRunId);
		if (!generation) throw new Error("expected persisted generation");

		const outputs = [
			await listStaticIntelligenceKnowledgeSources({
				db: connection.db,
				input: { limit: 10 },
				generatedAt: GENERATED_AT,
			}),
			await getStaticIntelligenceKnowledgeSourceManifestTool({
				db: connection.db,
				input: { scanRunId },
			}),
			await getStaticIntelligenceGuardrailMaterialTool({
				db: connection.db,
				input: { scanRunId },
			}),
			await getStaticIntelligenceEvidenceBundleTool({
				db: connection.db,
				input: { scanRunId, findingId },
			}),
			await getStaticIntelligenceVerificationCommandsTool({
				db: connection.db,
				input: { scanRunId, findingId },
			}),
			await getProjectExplorationCatalogTool({
				db: connection.db,
				input: {
					scanRunId,
					generationId: generation.generationId,
					focus: { paths: ["src/app.ts"] },
				},
			}),
		];
		const serialized = JSON.stringify(outputs);

		expect(serialized).not.toContain(RAW_SNIPPET_MARKER);
		expect(serialized).not.toContain(RAW_ARTIFACT_MARKER);
		expect(serialized).not.toContain(SECRET_MARKER);
		expect(serialized).not.toContain(REPO_PATH_MARKER);
	});

	async function seedProject(name: string, repoPath: string) {
		await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
		await fs.writeFile(path.join(repoPath, "src", "app.ts"), "export const app = true;\n");
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name,
				repoPath,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		return project.id;
	}

	async function seedScanRun(
		options: {
			projectId?: string;
			updatedAt?: Date;
		} = {},
	) {
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId: options.projectId ?? projectId,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: new Date(NOW.getTime() + 5000),
				createdByUserId: userId,
				createdAt: NOW,
				updatedAt: options.updatedAt ?? NOW,
			})
			.returning();
		return scanRun.id;
	}

	async function seedFindingBackedScan(
		options: {
			updatedAt?: Date;
			snippet?: string;
			artifactMetadata?: Record<string, unknown>;
		} = {},
	) {
		const scanRunId = await seedScanRun({ updatedAt: options.updatedAt });
		const [toolRun] = await connection.db
			.insert(toolRuns)
			.values({
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
			})
			.returning();
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
				metadata: options.artifactMetadata ?? {},
				createdAt: NOW,
			})
			.returning();
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: "typescript.express.xss",
				title: "Reflected XSS",
				description: "User-controlled value reaches a dangerous sink.",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/app.ts", startLine: 12 },
				fingerprint: `fp-${scanRunId}`,
				metadata: {},
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		await connection.db.insert(findingEvidences).values({
			findingId: finding.id,
			kind: "source-location",
			title: "Source location",
			artifactId: artifact.id,
			location: { path: "src/app.ts", startLine: 12 },
			snippet: options.snippet ?? "res.send(req.query.name);",
			metadata: {},
			createdAt: NOW,
		});
		return { scanRunId, findingId: finding.id };
	}

	async function seedCompletedScanReview(scanRunId: string) {
		await connection.db.insert(scanReviews).values({
			scanRunId,
			projectId,
			provider: "openai",
			model: "gpt-4o-mini",
			status: "completed",
			summary: "Review completed.",
			riskOverview: "High risk XSS finding.",
			priorityNotes: ["Fix the XSS first."],
			coverageNotes: [],
			falsePositiveHotspots: [],
			recommendedNextActions: ["Patch and test."],
			findingTriageHints: [],
			confidenceNotes: [],
			inputBundle: {},
			output: buildScanReviewOutput(),
			startedAt: NOW,
			completedAt: new Date(NOW.getTime() + 1000),
			createdAt: NOW,
			updatedAt: NOW,
		});
	}

	async function persistGeneration(scanRunId: string) {
		return await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId,
			generatedAt: GENERATED_AT,
		});
	}

	function rowCounts() {
		return {
			scanRuns: tableCount("scan_runs"),
			findings: tableCount("findings"),
			findingEvidences: tableCount("finding_evidence"),
			scanArtifacts: tableCount("scan_artifacts"),
			scanReviews: tableCount("scan_reviews"),
			toolRuns: tableCount("tool_runs"),
		};
	}

	function tableCount(tableName: string): number {
		const row = connection.sqlite
			.query(`select count(*) as count from ${tableName}`)
			.get() as { count: number };
		return row.count;
	}
});

function buildScanReviewOutput() {
	return {
		summary: "Review completed.",
		riskOverview: "High risk XSS finding.",
		priorityNotes: ["Fix the XSS first."],
		coverageNotes: [],
		falsePositiveHotspots: [],
		recommendedNextActions: ["Patch and test."],
		findingTriageHints: [],
		confidenceNotes: [],
		improvementRequest: {
			title: "Fix reflected XSS",
			objective: "Escape user-controlled output before rendering.",
			scope: ["Stored scan evidence only."],
			priorityPlan: [],
			implementationTasks: [],
			acceptanceCriteria: ["Injected HTML is escaped."],
			verificationCommands: ["bun test --filter xss"],
			constraints: ["Do not add a new scanner."],
			nonGoals: ["Do not redesign the app."],
			handoffPrompt: "Fix the reflected XSS based on stored evidence.",
		},
	};
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
