import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { findings, projects, scanRuns, users } from "../../db/schema";
import { FindingRepository, ProjectRepository, ScanRepository } from "../scans/repositories";
import { DynamicRepository } from "./dynamic-repository";

describe("DynamicRepository", () => {
	let connection: DbConnection;
	let projectRepo: ProjectRepository;
	let scanRepo: ScanRepository;
	let findingRepo: FindingRepository;
	let dynamicRepo: DynamicRepository;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let findingId: string;

	beforeEach(() => {
		connection = createDbConnection(":memory:");

		// Apply migrations
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		const sqlFiles = readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b));

		for (const filename of sqlFiles) {
			const sqlPath = path.resolve(migrationsDir, filename);
			const sqlText = readFileSync(sqlPath, "utf8");
			connection.sqlite.exec(sqlText);
		}

		projectRepo = new ProjectRepository(connection.db);
		scanRepo = new ScanRepository(connection.db);
		findingRepo = new FindingRepository(connection.db);
		dynamicRepo = new DynamicRepository(connection.db);

		// Seed a user
		const now = new Date();
		connection.sqlite.run(
			"INSERT INTO users (id, email, password_hash, display_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			[
				"user-1",
				"dynamic-test@example.com",
				"hash",
				"Test User",
				"member",
				1,
				now.getTime(),
				now.getTime(),
			],
		);
		userId = "user-1";

		// Seed a project
		connection.sqlite.run(
			"INSERT INTO projects (id, owner_user_id, name, repo_path, default_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			["project-1", userId, "Test Project", "/tmp/repo", "main", now.getTime(), now.getTime()],
		);
		projectId = "project-1";

		// Seed a scan run
		connection.sqlite.run(
			"INSERT INTO scan_runs (id, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			["scan-run-1", projectId, "completed", now.getTime(), now.getTime()],
		);
		scanRunId = "scan-run-1";

		// Seed a finding
		connection.sqlite.run(
			"INSERT INTO findings (id, scan_run_id, project_id, source_tool, rule_id, title, description, severity, confidence, status, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				"finding-1",
				scanRunId,
				projectId,
				"semgrep",
				"rule-1",
				"Title",
				"Desc",
				"high",
				"static",
				"open",
				"fp-1",
				now.getTime(),
				now.getTime(),
			],
		);
		findingId = "finding-1";
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("should create, read, update, and delete dynamic config profiles", async () => {
		// 1. Create
		const config = await dynamicRepo.createConfig({
			projectId,
			profileId: "bun-test",
			dynamicKind: "test",
			displayName: "Bun Test Config",
			commandJson: ["bun", "test"],
			writableWorkdir: true,
			createdByUserId: userId,
		});

		expect(config.profileId).toBe("bun-test");
		expect(config.dynamicKind).toBe("test");
		expect(config.commandJson).toEqual(["bun", "test"]);
		expect(config.writableWorkdir).toBe(true);

		// 2. Read
		const fetched = await dynamicRepo.getConfig(config.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.displayName).toBe("Bun Test Config");

		const fetchedByProfile = await dynamicRepo.getConfigByProfileId(projectId, "bun-test");
		expect(fetchedByProfile).not.toBeNull();
		expect(fetchedByProfile!.id).toBe(config.id);

		// 3. Update
		const updated = await dynamicRepo.updateConfig(config.id, {
			displayName: "Updated Display Name",
			timeoutSec: 200,
		});
		expect(updated).not.toBeNull();
		expect(updated!.displayName).toBe("Updated Display Name");
		expect(updated!.timeoutSec).toBe(200);

		// 4. List
		const configs = await dynamicRepo.listConfigsForProject(projectId);
		expect(configs).toHaveLength(1);
		expect(configs[0].id).toBe(config.id);

		// 5. Delete
		const deleted = await dynamicRepo.deleteConfig(config.id);
		expect(deleted).not.toBeNull();

		const fetchedDeleted = await dynamicRepo.getConfig(config.id);
		expect(fetchedDeleted).toBeNull();
	});

	it("should manage dynamic verification runs", async () => {
		const config = await dynamicRepo.createConfig({
			projectId,
			profileId: "parser-fuzz",
			dynamicKind: "fuzz",
			displayName: "Parser Fuzzer",
			commandJson: ["npm", "run", "fuzz"],
			allowProjectScripts: true,
			createdByUserId: userId,
		});

		// 1. Create run
		const run = await dynamicRepo.createRun({
			projectId,
			scanRunId,
			findingId,
			profileConfigId: config.id,
			profileId: "parser-fuzz",
			dynamicKind: "fuzz",
			status: "running",
			runner: "docker",
			commandJson: ["npm", "run", "fuzz"],
			createdByUserId: userId,
		});

		expect(run.status).toBe("running");
		expect(run.outcome).toBeNull();
		expect(run.profileId).toBe("parser-fuzz");
		expect(run.findingId).toBe(findingId);

		// 2. Read run
		const fetched = await dynamicRepo.getRun(run.id);
		expect(fetched).not.toBeNull();
		expect(fetched!.status).toBe("running");

		// 3. Update status to completed/crashed
		const updated = await dynamicRepo.updateRunStatus(run.id, "completed", {
			outcome: "crashed",
			exitCode: 139,
			summary: "Parser crashed on input",
		});
		expect(updated).not.toBeNull();
		expect(updated!.status).toBe("completed");
		expect(updated!.outcome).toBe("crashed");
		expect(updated!.exitCode).toBe(139);
		expect(updated!.summary).toBe("Parser crashed on input");

		// 4. List runs
		const projectRuns = await dynamicRepo.listRunsForProject(projectId);
		expect(projectRuns).toHaveLength(1);
		expect(projectRuns[0].id).toBe(run.id);

		const findingRuns = await dynamicRepo.listRunsForFinding(findingId);
		expect(findingRuns).toHaveLength(1);
		expect(findingRuns[0].id).toBe(run.id);
	});

	it("should manage dynamic run artifacts and evidence", async () => {
		const config = await dynamicRepo.createConfig({
			projectId,
			profileId: "cargo-asan",
			dynamicKind: "sanitizer",
			displayName: "Cargo ASAN",
			commandJson: ["cargo", "test"],
			createdByUserId: userId,
		});

		const run = await dynamicRepo.createRun({
			projectId,
			profileConfigId: config.id,
			profileId: "cargo-asan",
			dynamicKind: "sanitizer",
			status: "completed",
			runner: "docker",
			commandJson: ["cargo", "test"],
		});

		// 1. Create artifact
		const artifact = await dynamicRepo.createArtifact({
			dynamicRunId: run.id,
			projectId,
			findingId,
			kind: "stderr",
			format: "text",
			path: "stderr.log",
			sha256: "hash256",
			sizeBytes: 1024,
		});

		expect(artifact.kind).toBe("stderr");
		expect(artifact.path).toBe("stderr.log");

		// 2. List artifacts
		const artifacts = await dynamicRepo.listArtifacts(run.id);
		expect(artifacts).toHaveLength(1);
		expect(artifacts[0].id).toBe(artifact.id);

		// 3. Create evidence
		const ev = await dynamicRepo.createEvidence({
			dynamicRunId: run.id,
			projectId,
			findingId,
			kind: "sanitizer-finding",
			title: "ASAN Heap Use After Free",
			artifactId: artifact.id,
			snippet: "crasher address sanitizer trace",
		});

		expect(ev.kind).toBe("sanitizer-finding");
		expect(ev.title).toBe("ASAN Heap Use After Free");
		expect(ev.artifactId).toBe(artifact.id);

		// 4. List evidence
		const evList = await dynamicRepo.listEvidence(run.id);
		expect(evList).toHaveLength(1);
		expect(evList[0].id).toBe(ev.id);

		const findingEvList = await dynamicRepo.listEvidenceForFinding(findingId);
		expect(findingEvList).toHaveLength(1);
		expect(findingEvList[0].id).toBe(ev.id);
	});
});
