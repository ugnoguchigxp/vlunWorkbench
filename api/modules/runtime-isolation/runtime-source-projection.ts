import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import { matchesPluginGlob } from "../project-capabilities/path-patterns";
import { createScopedWorkspace } from "../scans/target-scope";
import type { FullSourceSnapshot } from "../scans/execution/lifecycle/full-source-snapshot";

export const RUNTIME_SOURCE_PROJECTION_POLICY_V1 = {
	version: 1 as const,
	excludeGlobs: [
		".env",
		".env.*",
		"**/.env",
		"**/.env.*",
		".npmrc",
		"**/.npmrc",
		".pypirc",
		"**/.pypirc",
		".netrc",
		"**/.netrc",
		".aws/**",
		"**/.aws/**",
		".config/gcloud/**",
		"**/.config/gcloud/**",
		"*.pem",
		"**/*.pem",
		"*.key",
		"**/*.key",
		"*.p12",
		"**/*.p12",
		"*.pfx",
		"**/*.pfx",
		"*.db",
		"**/*.db",
		"*.sqlite",
		"**/*.sqlite",
		"*.sqlite3",
		"**/*.sqlite3",
		"*.sock",
		"**/*.sock",
	],
} as const;

const RUNTIME_SOURCE_SCOPE: ScanScopePolicy = {
	intent: "source",
	includeGlobs: ["**/*"],
	excludeGlobs: [],
	includeGenerated: false,
	includeInstalledDependencies: false,
	includeVendoredDependencies: false,
};

type ExcludedCategory = "credential" | "database" | "socket" | "symlink";

export type RuntimeSourceProjection = {
	rootPath: string;
	projectPath: string;
	sourceSnapshotDigest: string;
	projectionDigest: string;
	policyVersion: 1;
	includedFileCount: number;
	excludedCategoryCounts: Record<ExcludedCategory, number>;
	cleanup: () => Promise<void>;
};

/**
 * Creates the only project tree that may be passed to a runtime target.
 * The input is a scanner snapshot, not the user's original repository.
 */
export async function materializeRuntimeSourceProjection(params: {
	snapshot: Pick<FullSourceSnapshot, "projectPath" | "snapshotDigest">;
}): Promise<RuntimeSourceProjection> {
	const sourceRoot = await fs.realpath(params.snapshot.projectPath);
	const excludedCategoryCounts = await countExcludedPaths(sourceRoot);
	let workspace: { path: string; copiedFiles: number } | null = null;
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) return;
		if (workspace) {
			await fs.rm(workspace.path, { recursive: true, force: true });
		}
		cleaned = true;
	};
	try {
		workspace = await createScopedWorkspace({
			repoPath: sourceRoot,
			scope: RUNTIME_SOURCE_SCOPE,
			additionalScope: {
				...RUNTIME_SOURCE_SCOPE,
				excludeGlobs: [...RUNTIME_SOURCE_PROJECTION_POLICY_V1.excludeGlobs],
			},
			prefix: path.join(os.tmpdir(), "vuln-workbench-runtime-source-"),
		});
		const projectPath = await fs.realpath(workspace.path);
		return {
			rootPath: projectPath,
			projectPath,
			sourceSnapshotDigest: params.snapshot.snapshotDigest,
			projectionDigest: await digestProjectionTree(projectPath),
			policyVersion: 1,
			includedFileCount: workspace.copiedFiles,
			excludedCategoryCounts,
			cleanup,
		};
	} catch (error) {
		await cleanup().catch(() => undefined);
		throw new Error(
			`runtime_source_projection_failed:${error instanceof Error ? error.message : "unknown"}`,
		);
	}
}

async function countExcludedPaths(
	root: string,
): Promise<Record<ExcludedCategory, number>> {
	const counts: Record<ExcludedCategory, number> = {
		credential: 0,
		database: 0,
		socket: 0,
		symlink: 0,
	};
	const walk = async (directory: string): Promise<void> => {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			const absolute = path.join(directory, entry.name);
			const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
			if (entry.isSymbolicLink()) {
				counts.symlink++;
				continue;
			}
			if (entry.isDirectory()) {
				await walk(absolute);
				continue;
			}
			if (!entry.isFile()) continue;
			const category = excludedCategoryFor(relative);
			if (category) counts[category]++;
		}
	};
	await walk(root);
	return counts;
}

function excludedCategoryFor(relativePath: string): ExcludedCategory | null {
	if (
		matchesPluginGlob(relativePath, "*.sock") ||
		matchesPluginGlob(relativePath, "**/*.sock")
	) {
		return "socket";
	}
	if (
		[
			"*.db",
			"**/*.db",
			"*.sqlite",
			"**/*.sqlite",
			"*.sqlite3",
			"**/*.sqlite3",
		].some((glob) => matchesPluginGlob(relativePath, glob))
	) {
		return "database";
	}
	if (
		RUNTIME_SOURCE_PROJECTION_POLICY_V1.excludeGlobs.some((glob) =>
			matchesPluginGlob(relativePath, glob),
		)
	) {
		return "credential";
	}
	return null;
}

async function digestProjectionTree(root: string): Promise<string> {
	const hash = crypto.createHash("sha256");
	const walk = async (directory: string): Promise<void> => {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries.sort((left, right) =>
			left.name.localeCompare(right.name),
		)) {
			const absolute = path.join(directory, entry.name);
			const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
			if (entry.isDirectory()) {
				hash.update(`d:${relative}\0`);
				await walk(absolute);
				continue;
			}
			if (!entry.isFile()) continue;
			const stat = await fs.stat(absolute);
			hash.update(`f:${relative}\0${stat.mode & 0o111}\0`);
			hash.update(await fs.readFile(absolute));
		}
	};
	await walk(root);
	return hash.digest("hex");
}
