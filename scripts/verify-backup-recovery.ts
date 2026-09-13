import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../api/db";
import { users } from "../api/db/schema";
import { closeTestDbConnection } from "../api/db/testing/connection";
import { migrateTestDatabase } from "../api/db/testing/migrate";
import { closeOwnedSqliteWriterClients } from "../api/db/writer/client";
import { ArtifactRepository } from "../api/modules/scans/execution/lifecycle/artifact-repository";
import { ArtifactStorage } from "../api/modules/scans/execution/lifecycle/artifact-storage";
import {
	ProjectRepository,
	ScanRepository,
} from "../api/modules/scans/repositories";
import {
	createDatabaseBackup,
	verifyDatabaseBackup,
} from "../api/operations/database-backup";

// Always creates disposable data. Never reads the configured application database.
const root = await mkdtemp(path.join(os.tmpdir(), "vw-recovery-"));
const previousSocket = process.env.SQLITE_WRITER_SOCKET;
delete process.env.SQLITE_WRITER_SOCKET;
let live: DbConnection | undefined;
let restored: DbConnection | undefined;
try {
	const database = path.join(root, "live.sqlite");
	await migrateTestDatabase(database);
	live = createDbConnection(database);
	const [user] = await live.db
		.insert(users)
		.values({
			email: "recovery@example.invalid",
			passwordHash: "fixture-only",
			displayName: "Recovery fixture",
			role: "member",
			isActive: true,
		})
		.returning();
	const project = await new ProjectRepository(live.db).createProject({
		ownerUserId: user.id,
		name: "Recovery",
		repoPath: root,
	});
	const scan = await new ScanRepository(live.db).createScanRun({
		projectId: project.id,
		profile: "standard",
		status: "completed",
		createdByUserId: user.id,
	});
	const sourceArtifacts = path.join(root, "live-artifacts");
	const saved = await new ArtifactStorage(sourceArtifacts).saveTextArtifact(
		scan.id,
		"reports",
		"# Recovery fixture\n",
		"report.md",
	);
	await new ArtifactRepository(live.db).createArtifact({
		scanRunId: scan.id,
		toolRunId: null,
		kind: "report",
		format: "markdown",
		...saved,
	});
	const backup = path.join(root, "backup.sqlite");
	await createDatabaseBackup(database, backup);
	const verified = await verifyDatabaseBackup(backup);
	await closeTestDbConnection(live);
	live = undefined;
	const restoredDatabase = path.join(root, "restored.sqlite");
	const restoredArtifacts = path.join(root, "restored-artifacts");
	await cp(backup, restoredDatabase, { errorOnExist: true, force: false });
	await cp(sourceArtifacts, restoredArtifacts, {
		recursive: true,
		errorOnExist: true,
		force: false,
	});
	restored = createDbConnection(restoredDatabase);
	const recoveredProject = await new ProjectRepository(restored.db).findById(
		project.id,
	);
	const recoveredScan = await new ScanRepository(restored.db).findById(scan.id);
	assert.equal(recoveredProject?.ownerUserId, user.id);
	assert.equal(recoveredScan?.projectId, project.id);
	const artifacts = await new ArtifactRepository(restored.db).listArtifacts(
		scan.id,
	);
	assert.equal(artifacts.length, 1);
	assert.equal(
		await new ArtifactStorage(restoredArtifacts).verifyArtifact(
			artifacts[0].path,
			artifacts[0],
			{ maxBytes: 1024 },
		),
		true,
	);
	console.log(
		JSON.stringify({
			ok: true,
			measuredAt: new Date().toISOString(),
			platform: process.platform,
			integrity: verified.integrity,
			appliedMigrations: verified.appliedMigrations,
			restoredProjects: 1,
			restoredScans: 1,
			verifiedArtifacts: 1,
			scope:
				"Disposable fixture DB and separately copied artifact bytes; no production restore or human handoff claim.",
		}),
	);
} finally {
	if (live) await closeTestDbConnection(live);
	if (restored) await closeTestDbConnection(restored);
	await closeOwnedSqliteWriterClients();
	await rm(root, { recursive: true, force: true });
	if (previousSocket === undefined) delete process.env.SQLITE_WRITER_SOCKET;
	else process.env.SQLITE_WRITER_SOCKET = previousSocket;
}
