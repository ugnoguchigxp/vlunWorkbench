import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanRuns, users } from "../../db/schema";
import { ArtifactStorage } from "../scans/artifact-storage";
import {
	buildStaticIntelligenceGeneration,
	StaticIntelligenceBuildInputError,
} from "./build-service";
import { StaticIntelligenceGenerationRepository } from "./generation-repository";

const NOW = new Date("2026-07-10T12:00:00.000Z");

describe("Static Intelligence build service", () => {
	let connection: DbConnection;
	let tempDir: string;
	let projectDir: string;
	let artifactDir: string;
	let scanRunId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "static-intel-build-"));
		projectDir = path.join(tempDir, "project");
		artifactDir = path.join(tempDir, "artifacts");
		await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
		await fs.writeFile(
			path.join(projectDir, "src", "app.ts"),
			"export const app = true;\n",
			"utf8",
		);
		connection = createDbConnection(":memory:");
		applyMigrations(connection);

		const [user] = await connection.db
			.insert(users)
			.values({
				email: "build-service@example.com",
				passwordHash: "password",
				displayName: "Build Service User",
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
				name: "Build Service Target",
				repoPath: projectDir,
				defaultBranch: "main",
				createdAt: NOW,
				updatedAt: NOW,
			})
			.returning();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId: project!.id,
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

	it("builds one persisted partial generation from the registered scan project", async () => {
		const storage = new ArtifactStorage(artifactDir);
		const result = await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId,
			artifactStorage: storage,
			generatedAt: new Date("2026-07-10T12:30:00.000Z"),
		});

		expect(result).toMatchObject({
			ok: true,
			status: "partial",
			scanRunId,
			generation: { status: "degraded" },
		});
		expect(result.stages.map((stage) => stage.name)).toEqual([
			"code_structure",
			"export",
			"persist",
			"semantic_index",
		]);
		expect(result.stages.at(-1)).toMatchObject({
			status: "skipped",
			reasonCodes: ["semantic_index_not_requested"],
		});
		expect(JSON.stringify(result)).not.toContain(projectDir);

		const persisted = await new StaticIntelligenceGenerationRepository(
			connection.db,
			storage,
		).loadGeneration(scanRunId, result.generation.generationId);
		expect(persisted?.structure.snapshot.files.map((file) => file.path)).toEqual([
			"src/app.ts",
		]);
	});

	it("returns an input error for an unknown scan", async () => {
		await expect(
			buildStaticIntelligenceGeneration({
				db: connection.db,
				scanRunId: "00000000-0000-4000-8000-000000000001",
				artifactStorage: new ArtifactStorage(artifactDir),
			}),
		).rejects.toBeInstanceOf(StaticIntelligenceBuildInputError);
	});

	it("runs a configured semantic stage and degrades without losing the generation", async () => {
		let indexedScanRunId: string | null = null;
		const successful = await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId,
			artifactStorage: new ArtifactStorage(artifactDir),
			includeSemantic: true,
			semanticIndexer: async (id) => {
				indexedScanRunId = id;
			},
		});
		expect(indexedScanRunId).toBe(scanRunId);
		expect(successful.stages.at(-1)).toMatchObject({
			status: "completed",
			reasonCodes: [],
		});

		const degraded = await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId,
			artifactStorage: new ArtifactStorage(artifactDir),
			includeSemantic: true,
			semanticIndexer: async () => {
				throw new Error("provider unavailable");
			},
		});
		expect(degraded.status).toBe("partial");
		expect(degraded.stages.at(-1)).toMatchObject({
			status: "degraded",
			reasonCodes: ["semantic_index_failed"],
		});
	});

	it("records git dirty-state hashes that change with dirty source bytes", async () => {
		for (const args of [
			["init"],
			["config", "user.email", "build-service@example.com"],
			["config", "user.name", "Build Service"],
			["add", "."],
			["commit", "-m", "initial"],
		]) {
			execFileSync("git", args, { cwd: projectDir, stdio: "ignore" });
		}
		const storage = new ArtifactStorage(artifactDir);
		await fs.writeFile(
			path.join(projectDir, "src", "app.ts"),
			"export const app = 'first';\n",
			"utf8",
		);
		const first = await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId,
			artifactStorage: storage,
		});
		await fs.writeFile(
			path.join(projectDir, "src", "app.ts"),
			"export const app = 'second';\n",
			"utf8",
		);
		const second = await buildStaticIntelligenceGeneration({
			db: connection.db,
			scanRunId,
			artifactStorage: storage,
		});

		const repository = new StaticIntelligenceGenerationRepository(
			connection.db,
			storage,
		);
		const firstGeneration = await repository.loadGeneration(
			scanRunId,
			first.generation.generationId,
		);
		const secondGeneration = await repository.loadGeneration(
			scanRunId,
			second.generation.generationId,
		);
		expect(firstGeneration?.structure.metadata.sourceRevision).toMatchObject({
			kind: "git",
			head: expect.any(String),
			dirtyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(secondGeneration?.structure.metadata.sourceRevision.dirtyHash).not.toBe(
			firstGeneration?.structure.metadata.sourceRevision.dirtyHash,
		);
	});
});

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((left, right) => left.localeCompare(right))) {
		connection.sqlite.exec(readFileSync(path.join(migrationsDir, filename), "utf8"));
	}
}
import { execFileSync } from "node:child_process";
