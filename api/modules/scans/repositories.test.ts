import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { scanRuns, users } from "../../db/schema";
import {
	ArtifactRepository,
	FindingRepository,
	ProjectRepository,
	ScanRepository,
} from "./repositories";

describe("Scan Domain Repositories", () => {
	let connection: DbConnection;
	let projectRepo: ProjectRepository;
	let scanRepo: ScanRepository;
	let artifactRepo: ArtifactRepository;
	let findingRepo: FindingRepository;
	let userId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");

		// Apply Drizzle migrations manually to in-memory SQLite
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		const sqlFiles = readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b));

		for (const filename of sqlFiles) {
			const sqlPath = path.resolve(migrationsDir, filename);
			const sql = readFileSync(sqlPath, "utf8");
			connection.sqlite.exec(sql);
		}

		projectRepo = new ProjectRepository(connection.db);
		scanRepo = new ScanRepository(connection.db);
		artifactRepo = new ArtifactRepository(connection.db);
		findingRepo = new FindingRepository(connection.db);

		// Seed a test user
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "test@example.com",
				passwordHash: "hash",
				displayName: "Test User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("should create projects and retrieve them", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Test Project",
			repoPath: "/path/to/repo",
		});

		expect(project.id).toBeDefined();
		expect(project.name).toBe("Test Project");

		const found = await projectRepo.findById(project.id);
		expect(found).not.toBeNull();
		expect(found?.name).toBe("Test Project");

		const foundByPath = await projectRepo.findByRepoPath(userId, "/path/to/repo");
		expect(foundByPath?.id).toBe(project.id);

		const list = await projectRepo.listProjects(userId);
		expect(list.length).toBe(1);
		expect(list[0].id).toBe(project.id);
	});

	it("should reject duplicate canonical repository paths across users", async () => {
		const now = new Date();
		const [otherUser] = await connection.db
			.insert(users)
			.values({
				email: "other@example.com",
				passwordHash: "hash",
				displayName: "Other User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		await projectRepo.createProject({
			ownerUserId: userId,
			name: "repo",
			repoPath: "/path/to/repo",
			canonicalRepoPath: "/path/to/repo",
		});

		await expect(
			projectRepo.createProject({
				ownerUserId: otherUser.id,
				name: "alias",
				repoPath: "/alias/to/repo",
				canonicalRepoPath: "/path/to/repo",
			}),
		).rejects.toThrow();
	});

	it("should run scans, generate events, and tools", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Test Project",
			repoPath: "/path/to/repo",
		});

		const scanRun = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "queued",
			createdByUserId: userId,
		});

		expect(scanRun.id).toBeDefined();
		expect(scanRun.status).toBe("queued");
		expect(scanRun.startedAt).toBeNull();

		const claimed = await scanRepo.claimQueuedScanRun({
			id: scanRun.id,
			projectId: project.id,
			profile: "baseline",
			metadata: { launchSource: "web" },
		});
		expect(claimed?.status).toBe("running");
		expect(claimed?.startedAt).toBeInstanceOf(Date);
		expect(claimed?.metadata).toMatchObject({ launchSource: "web" });
		expect(
			await scanRepo.claimQueuedScanRun({
				id: scanRun.id,
				projectId: project.id,
				profile: "baseline",
			}),
		).toBeNull();

		const updated = await scanRepo.updateScanRunStatus(scanRun.id, "running");
		expect(updated?.status).toBe("running");

		const found = await scanRepo.findById(scanRun.id);
		expect(found?.status).toBe("running");

		const scansForProject = await scanRepo.listScanRuns(project.id);
		expect(scansForProject).toHaveLength(1);
		expect(scansForProject[0].id).toBe(scanRun.id);

		// scan events
		const event = await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "scan.started",
			message: "Scan started",
		});
		expect(event.id).toBeDefined();

		const events = await scanRepo.listScanEvents(scanRun.id);
		expect(events.length).toBe(1);
		expect(events[0].message).toBe("Scan started");

		// tool runs
		const tool = await scanRepo.createToolRun({
			scanRunId: scanRun.id,
			toolName: "fixture",
			status: "running",
		});
		expect(tool.id).toBeDefined();
		expect(tool.toolName).toBe("fixture");

		const updatedTool = await scanRepo.updateToolRunStatus(tool.id, "completed", {
			exitCode: 0,
			toolVersion: "2.17.0",
			metadata: { image: "zaproxy/zap-stable@sha256:example" },
		});
		expect(updatedTool?.exitCode).toBe(0);
		expect(updatedTool?.toolVersion).toBe("2.17.0");
		expect(updatedTool?.metadata).toMatchObject({ image: "zaproxy/zap-stable@sha256:example" });
	});

	it("preserves null-valued nested scan metadata during an atomic merge", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Preflight metadata project",
			repoPath: "/path/to/preflight-metadata",
		});
		const scanRun = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "running",
			metadata: { existing: { preserved: true } },
		});

		await scanRepo.mergeScanRunMetadata(scanRun.id, {
			scanPreflight: {
				sourceRevision: null,
				binding: { dockerImagesHash: null, sourceRevisionHash: null },
			},
		});

		expect((await scanRepo.findById(scanRun.id))?.metadata).toEqual({
			existing: { preserved: true },
			scanPreflight: {
				sourceRevision: null,
				binding: { dockerImagesHash: null, sourceRevisionHash: null },
			},
		});
	});

	it("lists scan history newest first", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Ordered scans",
			repoPath: "/path/to/ordered-scans",
		});
		const older = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "older",
			status: "completed",
		});
		const newer = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "newer",
			status: "completed",
		});
		await connection.db
			.update(scanRuns)
			.set({ createdAt: new Date("2026-01-01T00:00:00.000Z") })
			.where(eq(scanRuns.id, older.id));
		await connection.db
			.update(scanRuns)
			.set({ createdAt: new Date("2026-01-02T00:00:00.000Z") })
			.where(eq(scanRuns.id, newer.id));

		expect(
			(await scanRepo.listScanRunsByProject(project.id)).map((scan) => scan.id),
		).toEqual([newer.id, older.id]);
	});

	it("reports a rejected active-to-terminal transition without overwriting the winner", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Transition Project",
			repoPath: "/path/to/transition-repo",
		});
		const scanRun = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "queued",
			createdByUserId: userId,
		});
		await scanRepo.updateScanRunStatus(scanRun.id, "completed");

		const rejected = await scanRepo.updateScanRunStatus(scanRun.id, "failed", {
			returnNullIfNotUpdated: true,
		});

		expect(rejected).toBeNull();
		expect((await scanRepo.findById(scanRun.id))?.status).toBe("completed");
	});

	it("should store scan artifacts, findings, and evidence", async () => {
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Test Project",
			repoPath: "/path/to/repo",
		});

		const scanRun = await scanRepo.createScanRun({
			projectId: project.id,
			profile: "baseline",
			status: "running",
		});

		const artifact = await artifactRepo.createArtifact({
			scanRunId: scanRun.id,
			toolRunId: null,
			kind: "raw_result",
			format: "json",
			path: "raw.json",
			sha256: "abc",
			sizeBytes: 123,
		});
		expect(artifact.id).toBeDefined();

		const artifacts = await artifactRepo.listArtifacts(scanRun.id);
		expect(artifacts.length).toBe(1);

		const finding = await findingRepo.createFinding({
			scanRunId: scanRun.id,
			projectId: project.id,
			sourceTool: "fixture",
			ruleId: "rule-1",
			title: "vuln",
			description: "desc",
			severity: "high",
			confidence: "static",
			status: "open",
			primaryLocation: { path: "src/index.js", line: 10 },
			fingerprint: "fp-1",
		});
		expect(finding.id).toBeDefined();

		const findingsList = await findingRepo.listFindings(scanRun.id);
		expect(findingsList.length).toBe(1);
		const secondFinding = await findingRepo.createFinding({
			scanRunId: scanRun.id,
			projectId: project.id,
			sourceTool: "fixture",
			ruleId: "rule-2",
			title: "second vuln",
			description: "desc",
			severity: "medium",
			confidence: "static",
			status: "open",
			primaryLocation: { path: "src/second.js", line: 20 },
			fingerprint: "fp-2",
		});
		const firstPage = await findingRepo.listFindingsPage(scanRun.id, {
			limit: 1,
		});
		expect(firstPage.items).toHaveLength(1);
		expect(firstPage.nextCursor).toBe(firstPage.items[0]?.id);
		const secondPage = await findingRepo.listFindingsPage(scanRun.id, {
			limit: 1,
			cursor: firstPage.nextCursor ?? undefined,
		});
		expect(secondPage.items).toHaveLength(1);
		expect(secondPage.nextCursor).toBeNull();
		expect(
			new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)),
		).toEqual(new Set([finding.id, secondFinding.id]));
		await expect(
			findingRepo.listFindingsPage(scanRun.id, {
				limit: 1,
				cursor: "missing-finding",
			}),
		).rejects.toThrow("FINDING_CURSOR_INVALID");

		const evidence = await findingRepo.createEvidence({
			findingId: finding.id,
			kind: "tool-output",
			title: "evidence 1",
			artifactId: artifact.id,
			location: { line: 10 },
			snippet: "code snippet",
		});
		expect(evidence.id).toBeDefined();

		const evidenceList = await findingRepo.listEvidence(finding.id);
		expect(evidenceList.length).toBe(1);
		expect(evidenceList[0].snippet).toBe("code snippet");
	});
});
