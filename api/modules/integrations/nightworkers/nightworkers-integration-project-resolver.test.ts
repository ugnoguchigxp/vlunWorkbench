import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuthenticatedIntegrationClient } from "../../integrationClients/integration-client.service";
import { resolveNightworkersProject } from "./nightworkers-integration-project-resolver";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vwi-project-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, { recursive: true, force: true }),
		),
	);
});

function client(
	overrides: Partial<AuthenticatedIntegrationClient> = {},
): AuthenticatedIntegrationClient {
	return {
		id: "client-1",
		name: "NightWorkers",
		ownerUserId: "owner-1",
		tokenPrefix: "0123456789abcdef",
		tokenHash: "a".repeat(64),
		scopes: ["nightworkers:security-scan:read"],
		allowedRoots: [],
		rateLimitPolicy: { limit: 60, windowMs: 60_000 },
		active: true,
		expiresAt: null,
		lastUsedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

describe("NightWorkers integration project resolver", () => {
	it("resolves an owner-matched registered canonical project", async () => {
		const root = await temporaryDirectory();
		const projectPath = await fs.mkdtemp(path.join(root, "repo-"));
		const project = {
			id: "project-1",
			ownerUserId: "owner-1",
			name: "repo",
			repoPath: projectPath,
			canonicalRepoPath: projectPath,
			defaultBranch: "main",
			metadata: {},
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const repository = {
			findByCanonicalRepoPath: async () => project,
			createProject: async () => {
				throw new Error("unexpected create");
			},
		};
		const resolved = await resolveNightworkersProject({
			projectPath,
			client: client({ allowedRoots: [root] }),
			projectRepository: repository as never,
			globalAllowedRoots: [root],
			autoCreateProjects: false,
		});
		expect(resolved.project.id).toBe("project-1");
		expect(resolved.created).toBe(false);
	});

	it("rejects a project outside the client-specific root", async () => {
		const globalRoot = await temporaryDirectory();
		const clientRoot = await temporaryDirectory();
		const projectPath = await fs.mkdtemp(path.join(globalRoot, "repo-"));
		await expect(
			resolveNightworkersProject({
				projectPath,
				client: client({ allowedRoots: [clientRoot] }),
				projectRepository: {} as never,
				globalAllowedRoots: [globalRoot],
				autoCreateProjects: false,
			}),
		).rejects.toMatchObject({ code: "project_path_denied" });
	});
});
