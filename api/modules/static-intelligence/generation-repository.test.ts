import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanArtifacts, scanRuns, users } from "../../db/schema";
import { createWritableTestDbConnection } from "../../db/testing/connection";
import { ArtifactStorage } from "../scans/artifact-storage";
import { buildStaticIntelligenceExport } from "./export-builder";
import {
	StaticIntelligenceGenerationRepository,
	StaticIntelligenceGenerationValidationError,
} from "./generation-repository";
import {
	buildSourceStateHash,
} from "./generation-types";
import { buildProjectStructureSnapshot } from "./project-structure/builder";
import { projectStructureV2ToCodeStructureV1 } from "./project-structure/v1-projector";
import { StaticIntelligenceRepository } from "./repository";

const NOW = new Date("2026-07-10T10:00:00.000Z");
const GENERATED_AT = "2026-07-10T10:30:00.000Z";

describe("Static Intelligence generation repository", () => {
	let connection: DbConnection;
	let tempDir: string;
	let projectDir: string;
	let artifactDir: string;
	let databaseUrl: string;
	let projectId: string;
	let scanRunId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "static-intel-generation-"));
		projectDir = path.join(tempDir, "project");
		artifactDir = path.join(tempDir, "artifacts");
		await fs.mkdir(projectDir, { recursive: true });
		databaseUrl = `file:${path.join(tempDir, "test.sqlite")}`;
		connection = createWritableTestDbConnection(databaseUrl);
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "generation-repository@example.com",
				passwordHash: "password",
				displayName: "Generation Repository User",
				role: "member",
				isActive: true,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: user!.id,
				name: "Generation Target",
				repoPath: projectDir,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		projectId = project!.id;
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: NOW,
				createdByUserId: user!.id,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		scanRunId = scanRun!.id;
	});

	afterEach(async () => {
		connection.sqlite.close();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("persists and reloads one validated structure/export generation after restart", async () => {
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		);
		const snapshot = await snapshotFixture();
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT), codeStructureSnapshot: snapshot },
		);

		const persisted = await repository.persistGeneration({
			scanRunId,
			snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
			exportPayload,
		});
		expect(persisted.status).toBe("degraded");
		expect(persisted.structure.metadata.generationId).toBe(
			persisted.export.metadata.generationId,
		);
		expect(persisted.structure.metadata.snapshotRef).toContain(
			"code_structure:",
		);
		expect(persisted.export.metadata.exportHash).toMatch(/^[a-f0-9]{64}$/);

		connection.sqlite.close();
		connection = createDbConnection(databaseUrl);
		const reloaded = await new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		).loadLatestValidGeneration(scanRunId);

		expect(reloaded?.generationId).toBe(persisted.generationId);
		expect(reloaded?.structure.snapshot).toEqual(snapshot);
		expect(reloaded?.export.payload).toEqual(exportPayload);
		expect(reloaded?.structure.artifact.path).not.toContain(projectDir);
	});

	it("excludes persisted derived artifacts from source state and rebuilt exports", async () => {
		const sourceRepository = new StaticIntelligenceRepository(connection.db);
		const beforeBundle = await sourceRepository.loadSourceBundle(scanRunId);
		if (!beforeBundle) throw new Error("Missing source bundle");
		const beforeSourceStateHash = buildSourceStateHash(beforeBundle);
		const snapshot = await snapshotFixture();
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT), codeStructureSnapshot: snapshot },
		);

		await new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		).persistGeneration({ scanRunId, snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef), exportPayload });

		const afterBundle = await sourceRepository.loadSourceBundle(scanRunId);
		if (!afterBundle) throw new Error("Missing source bundle");
		expect(afterBundle.artifacts).toEqual([]);
		expect(buildSourceStateHash(afterBundle)).toBe(beforeSourceStateHash);
		const rebuilt = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT) },
		);
		expect(rebuilt.scan.artifactCount).toBe(0);
		expect(rebuilt.graph.nodes.map((node) => node.kind)).toEqual([
			"project",
			"scan_run",
		]);
	});

	it("rejects a snapshot whose rootRef does not belong to the scan project", async () => {
		const snapshot = await snapshotFixture({
			rootRef:
				"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		});
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT) },
		);

		await expect(
			new StaticIntelligenceGenerationRepository(
				connection.db,
				new ArtifactStorage(artifactDir),
			).persistGeneration({ scanRunId, snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef), exportPayload }),
		).rejects.toBeInstanceOf(StaticIntelligenceGenerationValidationError);
	});

	it("keeps the last valid generation when a newer generation is incomplete", async () => {
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		);
		const snapshot = await snapshotFixture();
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT), codeStructureSnapshot: snapshot },
		);
		const valid = await repository.persistGeneration({
			scanRunId,
			snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
			exportPayload,
		});
		const invalidGenerationId = randomUUID();
		await connection.db.insert(scanArtifacts).values({
			scanRunId,
			kind: "code_structure_snapshot",
			format: "json",
			path: `${scanRunId}/derived/static-intelligence/${invalidGenerationId}/missing.json`,
			sha256: "0".repeat(64),
			sizeBytes: 0,
			metadata: {
				...valid.structure.metadata,
				generationId: invalidGenerationId,
				generatedAt: "2026-07-10T11:00:00.000Z",
			},
			createdAt: new Date("2026-07-10T11:00:00.000Z"),
		});

		const latest = await repository.loadLatestValidGeneration(scanRunId);
		expect(latest?.generationId).toBe(valid.generationId);
		await expect(
			repository.loadGeneration(scanRunId, invalidGenerationId),
		).rejects.toThrow("Generation is incomplete or invalid");
	});

	it("rejects a declared v2 generation when its canonical artifact row is missing", async () => {
		await fs.writeFile(path.join(projectDir, "app.ts"), "export const app = true;\n");
		const projectStructureSnapshot = await buildProjectStructureSnapshot({
			projectPath: projectDir,
			projectId,
			generatedAt: new Date(GENERATED_AT),
		});
		const snapshot = projectStructureV2ToCodeStructureV1(projectStructureSnapshot);
		const exportPayload = await buildStaticIntelligenceExport(connection.db, scanRunId, {
			generatedAt: new Date(GENERATED_AT),
			codeStructureSnapshot: snapshot,
		});
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		);
		const persisted = await repository.persistGeneration({
			scanRunId,
			snapshot,
			projectStructureSnapshot,
			exportPayload,
		});
		expect(persisted.projectStructure).toBeDefined();
		await connection.db
			.delete(scanArtifacts)
			.where(eq(scanArtifacts.id, persisted.projectStructure!.artifact.id));
		await expect(
			repository.loadGeneration(scanRunId, persisted.generationId),
		).rejects.toThrow("Generation is incomplete or invalid");
	});

	it("rejects duplicate artifacts for one generation deterministically", async () => {
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		);
		const snapshot = await snapshotFixture();
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT), codeStructureSnapshot: snapshot },
		);
		const persisted = await repository.persistGeneration({
			scanRunId,
			snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
			exportPayload,
		});
		const artifact = persisted.export.artifact;
		await connection.db.insert(scanArtifacts).values({
			id: randomUUID(),
			scanRunId: artifact.scanRunId,
			toolRunId: artifact.toolRunId,
			kind: artifact.kind,
			format: artifact.format,
			path: artifact.path,
			sha256: artifact.sha256,
			sizeBytes: artifact.sizeBytes,
			metadata: artifact.metadata,
			createdAt: artifact.createdAt,
		});

		await expect(
			repository.loadGeneration(scanRunId, persisted.generationId),
		).rejects.toThrow("Generation is incomplete or invalid");
		expect(
			await repository.listLatestValidGenerationsByRootRef({
				rootRef: snapshot.project.rootRef,
				limit: 10,
			}),
		).toEqual([]);
	});

	it("rejects duplicate generation ids and source-state races before writing files", async () => {
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		);
		const snapshot = await snapshotFixture();
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT), codeStructureSnapshot: snapshot },
		);
		const persisted = await repository.persistGeneration({
			scanRunId,
			snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
			exportPayload,
		});

		await expect(
			repository.persistGeneration({
				scanRunId,
				snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
				exportPayload,
				generationId: persisted.generationId,
			}),
		).rejects.toThrow("Generation already exists");
		await expect(
			repository.persistGeneration({
				scanRunId,
				snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
				exportPayload,
				expectedSourceStateHash: "0".repeat(64),
			}),
		).rejects.toThrow("Scan source state changed before generation persistence");
	});

	it("rejects persisted pairs whose metadata does not match the artifact scan", async () => {
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		);
		const snapshot = await snapshotFixture();
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT), codeStructureSnapshot: snapshot },
		);
		const persisted = await repository.persistGeneration({
			scanRunId,
			snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
			exportPayload,
		});
		for (const entry of [persisted.structure, persisted.export]) {
			await connection.db
				.update(scanArtifacts)
				.set({
					metadata: { ...entry.metadata, scanRunId: "another-scan" },
				})
				.where(eq(scanArtifacts.id, entry.artifact.id));
		}

		await expect(
			repository.loadGeneration(scanRunId, persisted.generationId),
		).rejects.toThrow("Generation is incomplete or invalid");
	});

	it("changes source state when project metadata changes the export payload", async () => {
		const sourceRepository = new StaticIntelligenceRepository(connection.db);
		const before = await sourceRepository.loadSourceBundle(scanRunId);
		if (!before) throw new Error("Missing source bundle");
		const beforeHash = buildSourceStateHash(before);
		await connection.db
			.update(projects)
			.set({ name: "Renamed Generation Target", updatedAt: new Date(NOW.getTime() + 1) })
			.where(eq(projects.id, projectId));
		const after = await sourceRepository.loadSourceBundle(scanRunId);
		if (!after) throw new Error("Missing source bundle");
		expect(buildSourceStateHash(after)).not.toBe(beforeHash);
	});

	it("cleans written files when metadata validation fails before the database insert", async () => {
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		);
		const snapshot = await snapshotFixture();
		const exportPayload = await buildStaticIntelligenceExport(
			connection.db,
			scanRunId,
			{ generatedAt: new Date(GENERATED_AT), codeStructureSnapshot: snapshot },
		);
		const generationId = randomUUID();
		await expect(
			repository.persistGeneration({
				scanRunId,
				snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
				exportPayload,
				generationId,
				sourceRevision: { kind: "git", value: "invalid-without-head" },
			}),
		).rejects.toThrow("Git source revision requires head");

		const artifactRows = await connection.db
			.select()
			.from(scanArtifacts)
			.where(eq(scanArtifacts.scanRunId, scanRunId));
		expect(artifactRows).toEqual([]);
		await expect(
			fs.stat(
				path.join(
					artifactDir,
					scanRunId,
					"derived",
					"static-intelligence",
					generationId,
					"code-structure.json",
				),
			),
		).rejects.toThrow();
	});

	it("discovers exact rootRef generations before applying limit", async () => {
		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			new ArtifactStorage(artifactDir),
		);
		const rootRef = createHash("sha256")
			.update(await fs.realpath(projectDir))
			.digest("hex");
		const persistPrimary = async (generationId: string, generatedAt: string) => {
			const snapshot = await snapshotFixture();
			const exportPayload = await buildStaticIntelligenceExport(
				connection.db,
				scanRunId,
				{ generatedAt: new Date(generatedAt), codeStructureSnapshot: snapshot },
			);
			return repository.persistGeneration({
				scanRunId,
				snapshot,
			projectStructureSnapshot: await projectStructureFixture(snapshot.project.rootRef),
				exportPayload,
				generationId,
			});
		};
		const older = await persistPrimary(
			"00000000-0000-4000-8000-000000000001",
			"2026-07-10T10:30:00.000Z",
		);
		await persistPrimary(
			"00000000-0000-4000-8000-000000000003",
			"2026-07-10T11:00:00.000Z",
		);
		const expectedFirst = await persistPrimary(
			"00000000-0000-4000-8000-000000000002",
			"2026-07-10T11:00:00.000Z",
		);
		expect((await repository.loadLatestValidGeneration(scanRunId))?.generationId).toBe(
			expectedFirst.generationId,
		);

		const [owner] = await connection.db.select().from(users).limit(1);
		if (!owner) throw new Error("Missing fixture owner");
		const otherDir = path.join(tempDir, "other-project");
		await fs.mkdir(otherDir, { recursive: true });
		const [otherProject] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: owner.id,
				name: "Other Generation Target",
				repoPath: otherDir,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const [otherScan] = await connection.db
			.insert(scanRuns)
			.values({
				projectId: otherProject!.id,
				profile: "baseline",
				status: "completed",
				startedAt: NOW,
				completedAt: NOW,
				createdByUserId: owner.id,
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const otherSnapshot = await snapshotFixture();
		otherSnapshot.project = {
			id: otherProject!.id,
			rootRef: createHash("sha256")
				.update(await fs.realpath(otherDir))
				.digest("hex"),
			rootPathIncluded: false,
		};
		const otherExport = await buildStaticIntelligenceExport(
			connection.db,
			otherScan!.id,
			{
				generatedAt: new Date("2026-07-10T12:00:00.000Z"),
				codeStructureSnapshot: otherSnapshot,
			},
		);
		await repository.persistGeneration({
			scanRunId: otherScan!.id,
			snapshot: otherSnapshot,
			projectStructureSnapshot: await buildProjectStructureSnapshot({
				projectPath: otherDir,
				projectId: otherProject!.id,
				generatedAt: new Date("2026-07-10T12:00:00.000Z"),
			}),
			exportPayload: otherExport,
			generationId: "00000000-0000-4000-8000-000000000099",
		});

		await connection.db.insert(scanArtifacts).values([
			{
				scanRunId,
				kind: "code_structure_snapshot",
				format: "json",
				path: "malformed.json",
				sha256: "0".repeat(64),
				sizeBytes: 0,
				metadata: { rootRef },
				createdAt: new Date("2026-07-10T13:00:00.000Z"),
			},
			{
				scanRunId,
				kind: "code_structure_snapshot",
				format: "json",
				path: "incomplete.json",
				sha256: "0".repeat(64),
				sizeBytes: 0,
				metadata: {
					...older.structure.metadata,
					generationId: "00000000-0000-4000-8000-000000000004",
					generatedAt: "2026-07-10T13:00:00.000Z",
				},
				createdAt: new Date("2026-07-10T13:00:00.000Z"),
			},
		]);

		const limited = await repository.listLatestValidGenerationsByRootRef({
			rootRef,
			limit: 1,
		});
		expect(limited).toHaveLength(1);
		expect(limited[0]).toEqual(expectedFirst);
		const all = await repository.listLatestValidGenerationsByRootRef({
			rootRef,
			projectId,
			limit: 10,
		});
		expect(all.map((generation) => generation.generationId)).toEqual([
			"00000000-0000-4000-8000-000000000002",
			"00000000-0000-4000-8000-000000000003",
			"00000000-0000-4000-8000-000000000001",
		]);
		expect(
			await repository.listLatestValidGenerationsByRootRef({
				rootRef,
				projectId: otherProject!.id,
				limit: 10,
			}),
		).toEqual([]);
	});

	async function projectStructureFixture(rootRef: string) {
		await fs.writeFile(
			path.join(projectDir, "app.ts"),
			"export const app = true;\n",
		);
		const snapshot = await buildProjectStructureSnapshot({
			projectPath: projectDir,
			projectId,
			generatedAt: new Date(GENERATED_AT),
		});
		return {
			...snapshot,
			project: { ...snapshot.project, rootRef },
		};
	}

	async function snapshotFixture(
		overrides: { rootRef?: string } = {},
	): Promise<CodeStructureSnapshot> {
		return {
			version: "v1" as const,
			generatedAt: GENERATED_AT,
			project: {
				id: projectId,
				rootRef:
					overrides.rootRef ??
					createHash("sha256")
						.update(await fs.realpath(projectDir))
						.digest("hex"),
				rootPathIncluded: false,
			},
			status: "completed" as const,
			degradedReasons: [],
			files: [
				{
					path: "src/app.ts",
					language: "typescript" as const,
					moduleKind: "esm" as const,
					tags: ["source"],
					exportedSymbols: ["app"],
					imports: [],
					packageImports: [],
					contentHash:
						"abcdef0000000000000000000000000000000000000000000000000000000000",
					parseStatus: "parsed" as const,
					degradedReasons: [],
				},
			],
			edges: [],
			packages: [],
			summary: {
				fileCount: 1,
				parsedFileCount: 1,
				skippedFileCount: 0,
				importEdgeCount: 0,
				packageDependencyCount: 0,
				exportedSymbolCount: 1,
				routeFileCount: 0,
				handlerFileCount: 0,
				schemaFileCount: 0,
				workerFileCount: 0,
				testFileCount: 0,
				configFileCount: 0,
			},
		};
	}
});

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((left, right) => left.localeCompare(right))) {
		connection.sqlite.exec(readFileSync(path.join(migrationsDir, filename), "utf8"));
	}
}
