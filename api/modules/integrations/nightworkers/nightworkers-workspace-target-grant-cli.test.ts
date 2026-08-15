import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../../db";
import {
	integrationClients,
	projects,
	users,
} from "../../../db/schema";
import { resolveWorkspaceTargetGrantPath } from "./nightworkers-workspace-target-grant-cli";
import { NightworkersWorkspaceTargetGrantRepository } from "./nightworkers-workspace-target-grant.repository";
import { captureWorkspaceTargetState } from "./nightworkers-workspace-target-state";

const exec = promisify(execFile);

describe("resolveWorkspaceTargetGrantPath", () => {
	let connection: DbConnection;
	let root: string;
	let repositoryPath: string;
	let grantRepository: NightworkersWorkspaceTargetGrantRepository;
	let grantRef: string;
	let integrationClientId: string;
	let projectId: string;
	let scanRunId: string;
	let targetDigest: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "vw-workspace-grant-cli-"));
		repositoryPath = path.join(root, "repository");
		await fs.mkdir(repositoryPath);
		repositoryPath = await fs.realpath(repositoryPath);
		await git(repositoryPath, "init");
		await git(repositoryPath, "config", "user.email", "fixture@example.com");
		await git(repositoryPath, "config", "user.name", "Fixture");
		await fs.writeFile(path.join(repositoryPath, "README.md"), "initial\n");
		await git(repositoryPath, "add", "README.md");
		await git(repositoryPath, "commit", "-m", "initial");
		await fs.writeFile(path.join(repositoryPath, "README.md"), "changed\n");

		const state = await captureWorkspaceTargetState({
			workspacePath: repositoryPath,
			allowedRoots: [root],
		});
		targetDigest = state.targetDigest;
		connection = createDbConnection(":memory:");
		applyMigrations(connection);
		const now = new Date("2026-08-15T00:00:00.000Z");
		const [owner] = await connection.db
			.insert(users)
			.values({
				email: "workspace-grant-cli@example.com",
				passwordHash: "hash",
				displayName: "Workspace grant CLI",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: owner.id,
				name: "Workspace grant CLI project",
				repoPath: repositoryPath,
				canonicalRepoPath: repositoryPath,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;
		const [client] = await connection.db
			.insert(integrationClients)
			.values({
				name: "workspace-grant-cli-client",
				ownerUserId: owner.id,
				tokenPrefix: "1234567890abcdef",
				tokenHash: "f".repeat(64),
				scopes: ["nightworkers:security-scan:write"],
				allowedRoots: [root],
				rateLimitPolicy: { limit: 100, windowMs: 60_000 },
				active: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		integrationClientId = client.id;

		grantRepository = new NightworkersWorkspaceTargetGrantRepository(
			connection.db,
		);
		grantRef = `siwg:v1:${"1".repeat(64)}`;
		const grant = await grantRepository.create({
			grantRef,
			grantDigest: `sha256:${"1".repeat(64)}`,
			integrationClientId: client.id,
			ownerUserId: owner.id,
			projectId,
			workspaceSubjectRef: "workspace-subject:cli",
			canonicalWorkspacePath: state.canonicalWorkspacePath,
			expectedGitCommonDirDigest: state.gitCommonDirDigest,
			expectedHeadSha: state.headSha,
			providerWorkspaceStateDigest: state.workspaceStateDigest,
			expiresAt: new Date("2030-01-01T00:00:00.000Z"),
		});
		const preview = await grantRepository.savePreview({
			grantId: grant.id,
			expectedRevision: grant.revision,
			previewRef: `siwp:v1:${"2".repeat(64)}`,
			selection: { mode: "preset", presetId: "standard" },
			targetDigest,
			sourceRevision: state.headSha,
			workspaceStateDigest: state.workspaceStateDigest,
			expiresAt: new Date("2030-01-01T00:00:00.000Z"),
		});
		if (!preview) throw new Error("preview fixture was not saved");
		const consumed = await grantRepository.consumeAndCreateScan({
			grantId: grant.id,
			grantRef,
			expectedRevision: preview.revision,
			integrationClientId: client.id,
			ownerUserId: owner.id,
			projectId,
			profileRef: "diff-basic-security",
			requestHash: "request-hash",
			idempotencyKey: "workspace-start-key",
			idempotencyExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
			metadata: { target: { kind: "working_tree" } },
			eventMessage: "Workspace scan queued.",
			maxConcurrentScans: 10,
		});
		scanRunId = consumed.resourceId;
	});

	afterEach(async () => {
		connection?.sqlite.close();
		await fs.rm(root, { recursive: true, force: true });
	});

	it("resolves only the consumed scan binding and immediately redacts the path", async () => {
		await expect(resolveGrant()).resolves.toBe(repositoryPath);
		await expect(storedPath()).resolves.toBe("");
	});

	it("rejects workspace drift and still redacts the captured path", async () => {
		await fs.writeFile(path.join(repositoryPath, "README.md"), "drifted\n");

		await expect(resolveGrant()).rejects.toThrow(
			"WORKSPACE_TARGET_GRANT_STATE_MISMATCH",
		);
		await expect(storedPath()).resolves.toBe("");
	});

	function resolveGrant() {
		return resolveWorkspaceTargetGrantPath({
			db: connection.db,
			grantRef,
			projectId,
			scanRunId,
			executionSurface: "web",
			target: { kind: "working_tree", includeUntracked: true },
			expectedTargetDigest: targetDigest,
		});
	}

	async function storedPath(): Promise<string | undefined> {
		return (
			await grantRepository.findForClient({
				grantRef,
				integrationClientId,
			})
		)?.canonicalWorkspacePath;
	}
});

async function git(cwd: string, ...args: string[]): Promise<void> {
	await exec("git", ["-C", cwd, ...args]);
}

function applyMigrations(connection: DbConnection): void {
	const migrationsDirectory = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDirectory)
		.filter((file) => file.endsWith(".sql"))
		.sort((left, right) => left.localeCompare(right))) {
		connection.sqlite.exec(
			readFileSync(path.resolve(migrationsDirectory, filename), "utf8"),
		);
	}
}
