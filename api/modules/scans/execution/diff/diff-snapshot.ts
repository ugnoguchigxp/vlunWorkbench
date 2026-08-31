import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DiffManifestEntry } from "../../../../../shared/schemas/scan-target.schema";
import { DEPENDENCY_MANIFEST_SCOPE } from "../../profiles";
import { runGitCommand } from "./git-command";
import type { DiffScanPlan } from "./diff-scan-plan";
import { GitDiffResolutionError } from "./git-diff-resolver";
import { matchesScopePath } from "../../target-scope";

export type DiffSnapshot = {
	rootPath: string;
	projectPath: string;
	changedWorkspacePath: string;
	trivyWorkspacePath: string;
	snapshotDigest: string;
	copiedChangedFiles: number;
	trivyContextFileCount: number;
	cleanup: () => Promise<void>;
};

export async function materializeDiffSnapshot(params: {
	plan: DiffScanPlan;
	expectedTargetDigest?: string;
}): Promise<DiffSnapshot> {
	if (
		params.plan.manifest.entries.some((entry) => entry.status === "unmerged")
	) {
		throw new GitDiffResolutionError(
			"unmerged_worktree",
			"Working tree contains unmerged paths.",
		);
	}
	if (
		params.expectedTargetDigest &&
		params.expectedTargetDigest !== params.plan.target.targetDigest
	) {
		throw new GitDiffResolutionError(
			"target_changed",
			"Diff target changed after preview.",
		);
	}
	const tempRoot = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "vuln-workbench-diff-")),
	);
	const checkoutRoot = path.join(tempRoot, "target");
	const changedWorkspacePath = path.join(tempRoot, "changed");
	const trivyWorkspacePath = path.join(tempRoot, "trivy");
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) return;
		await fs.rm(tempRoot, { recursive: true, force: true });
		cleaned = true;
		process.off("SIGTERM", handleSigterm);
		process.off("SIGINT", handleSigint);
	};
	const terminateAfterCleanup = (exitCode: number) => {
		void cleanup().finally(() => process.exit(exitCode));
	};
	function handleSigterm() {
		terminateAfterCleanup(143);
	}
	function handleSigint() {
		terminateAfterCleanup(130);
	}
	process.once("SIGTERM", handleSigterm);
	process.once("SIGINT", handleSigint);

	try {
		await runGitCommand({
			cwd: tempRoot,
			args: [
				"clone",
				"--shared",
				"--no-checkout",
				"--",
				params.plan.resolved.gitRoot,
				checkoutRoot,
			],
			timeoutMs: 120_000,
		});
		const checkoutSha =
			params.plan.target.kind === "working_tree"
				? params.plan.target.baseSha
				: (params.plan.target.headSha as string);
		await runGitCommand({
			cwd: checkoutRoot,
			args: ["checkout", "--detach", checkoutSha],
			timeoutMs: 120_000,
		});
		await fs.rm(path.join(checkoutRoot, ".git"), {
			recursive: true,
			force: true,
		});
		const projectPath = params.plan.target.projectPrefix
			? path.join(checkoutRoot, params.plan.target.projectPrefix)
			: checkoutRoot;
		await fs.mkdir(projectPath, { recursive: true });

		if (params.plan.target.kind === "working_tree") {
			await overlayWorkingTree({
				sourceRoot: params.plan.resolved.projectRoot,
				projectPath,
				entries: params.plan.manifest.entries,
			});
		}
		await pruneNonScannableEntries(projectPath, params.plan.manifest.entries);
		await materializeAndVerifyScannableEntries(
			projectPath,
			params.plan.manifest.entries,
		);

		await fs.mkdir(changedWorkspacePath, { recursive: true });
		await fs.mkdir(trivyWorkspacePath, { recursive: true });
		let copiedChangedFiles = 0;
		for (const entry of params.plan.manifest.entries) {
			if (entry.disposition !== "scan") continue;
			const sourcePath = path.resolve(projectPath, entry.path);
			const destinationPath = path.resolve(changedWorkspacePath, entry.path);
			assertInside(sourcePath, projectPath);
			assertInside(destinationPath, changedWorkspacePath);
			await copySnapshotEntry(sourcePath, destinationPath, projectPath);
			await copySnapshotEntry(
				sourcePath,
				path.resolve(trivyWorkspacePath, entry.path),
				projectPath,
			);
			copiedChangedFiles++;
		}
		const trivyContextFileCount = await copyDependencyCompanions({
			plan: params.plan,
			projectPath,
			trivyWorkspacePath,
		});

		return {
			rootPath: checkoutRoot,
			projectPath,
			changedWorkspacePath,
			trivyWorkspacePath,
			snapshotDigest: params.plan.target.targetDigest,
			copiedChangedFiles,
			trivyContextFileCount,
			cleanup,
		};
	} catch (error) {
		await cleanup();
		if (error instanceof GitDiffResolutionError) throw error;
		throw new GitDiffResolutionError(
			"snapshot_materialization_failed",
			"Failed to materialize the immutable diff snapshot.",
			{
				causeType: error instanceof Error ? error.name : "UnknownError",
			},
		);
	}
}

async function copyDependencyCompanions(params: {
	plan: DiffScanPlan;
	projectPath: string;
	trivyWorkspacePath: string;
}): Promise<number> {
	if (!params.plan.pluginContext.dependencyStateChanged) return 0;
	const changedPaths = new Set(params.plan.scanPaths);
	let contextFileCount = 0;
	const walk = async (directory: string): Promise<void> => {
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries.sort((left, right) =>
			left.name.localeCompare(right.name),
		)) {
			const sourcePath = path.resolve(directory, entry.name);
			assertInside(sourcePath, params.projectPath);
			const relativePath = path
				.relative(params.projectPath, sourcePath)
				.replaceAll(path.sep, "/");
			if (entry.isDirectory()) {
				if (
					!matchesScopePath(`${relativePath}/placeholder`, {
						...DEPENDENCY_MANIFEST_SCOPE,
						includeGlobs: ["**/*"],
					})
				) {
					continue;
				}
				await walk(sourcePath);
				continue;
			}
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			if (
				changedPaths.has(relativePath) ||
				!matchesScopePath(relativePath, DEPENDENCY_MANIFEST_SCOPE)
			) {
				continue;
			}
			if (contextFileCount >= 5_000) {
				throw new GitDiffResolutionError(
					"snapshot_materialization_failed",
					"Dependency companion file limit reached.",
				);
			}
			await copySnapshotEntry(
				sourcePath,
				path.resolve(params.trivyWorkspacePath, relativePath),
				params.projectPath,
			);
			contextFileCount++;
		}
	};
	await walk(params.projectPath);
	return contextFileCount;
}

async function overlayWorkingTree(params: {
	sourceRoot: string;
	projectPath: string;
	entries: DiffManifestEntry[];
}): Promise<void> {
	for (const entry of params.entries) {
		if (entry.status === "renamed" && entry.oldPath) {
			const oldTarget = path.resolve(params.projectPath, entry.oldPath);
			assertInside(oldTarget, params.projectPath);
			await fs.rm(oldTarget, { recursive: true, force: true });
		}
		const targetPath = path.resolve(params.projectPath, entry.path);
		assertInside(targetPath, params.projectPath);
		if (entry.status === "deleted") {
			await fs.rm(targetPath, { recursive: true, force: true });
			continue;
		}
		if (entry.disposition !== "scan") {
			await fs.rm(targetPath, { recursive: true, force: true });
			continue;
		}
		const sourcePath = path.resolve(params.sourceRoot, entry.path);
		assertInside(sourcePath, params.sourceRoot);
		await copyWorkingEntry(sourcePath, targetPath, params.sourceRoot);
	}
}

async function pruneNonScannableEntries(
	projectPath: string,
	entries: DiffManifestEntry[],
): Promise<void> {
	for (const entry of entries) {
		if (entry.disposition === "scan") continue;
		const targetPath = path.resolve(projectPath, entry.path);
		assertInside(targetPath, projectPath);
		await fs.rm(targetPath, { recursive: true, force: true });
	}
}

async function copyWorkingEntry(
	sourcePath: string,
	destinationPath: string,
	sourceRoot: string,
): Promise<void> {
	const stat = await fs.lstat(sourcePath);
	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	await fs.rm(destinationPath, { recursive: true, force: true });
	if (stat.isSymbolicLink()) {
		const resolved = await fs.realpath(sourcePath);
		assertInside(resolved, sourceRoot);
		const targetStat = await fs.stat(resolved);
		if (!targetStat.isFile()) {
			throw new GitDiffResolutionError(
				"snapshot_materialization_failed",
				"Changed symlink target is not a file.",
			);
		}
		await fs.copyFile(resolved, destinationPath);
		await fs.chmod(destinationPath, targetStat.mode);
		return;
	}
	if (!stat.isFile()) {
		throw new GitDiffResolutionError(
			"snapshot_materialization_failed",
			"Changed path is not a file or symlink.",
		);
	}
	await fs.copyFile(sourcePath, destinationPath);
	await fs.chmod(destinationPath, stat.mode);
}

async function materializeAndVerifyScannableEntries(
	projectPath: string,
	entries: DiffManifestEntry[],
): Promise<void> {
	const canonicalProjectPath = await fs.realpath(projectPath);
	for (const entry of entries) {
		if (entry.disposition !== "scan") continue;
		const targetPath = path.resolve(canonicalProjectPath, entry.path);
		assertInside(targetPath, canonicalProjectPath);
		const stat = await fs.lstat(targetPath);
		if (stat.isSymbolicLink()) {
			const resolvedBefore = await fs.realpath(targetPath);
			assertInside(resolvedBefore, canonicalProjectPath);
			const targetStat = await fs.stat(resolvedBefore);
			if (!targetStat.isFile()) {
				throw new GitDiffResolutionError(
					"snapshot_materialization_failed",
					`Scannable symlink target is not a file: ${entry.path}`,
				);
			}
			const content = await fs.readFile(resolvedBefore);
			const resolvedAfter = await fs.realpath(targetPath);
			assertInside(resolvedAfter, canonicalProjectPath);
			if (resolvedAfter !== resolvedBefore) {
				throw new GitDiffResolutionError(
					"target_changed",
					`Symlink target mutated while the snapshot was being created: ${entry.path}`,
				);
			}
			await fs.rm(targetPath, { force: true });
			await fs.writeFile(targetPath, content, { mode: targetStat.mode });
		}
		await verifyCopiedEntry(targetPath, entry);
	}
}

async function copySnapshotEntry(
	sourcePath: string,
	destinationPath: string,
	sourceRoot: string,
): Promise<void> {
	const stat = await fs.lstat(sourcePath);
	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	if (stat.isSymbolicLink()) {
		const resolved = await fs.realpath(sourcePath);
		assertInside(resolved, await fs.realpath(sourceRoot));
		await fs.copyFile(resolved, destinationPath);
		return;
	}
	if (!stat.isFile()) {
		throw new GitDiffResolutionError(
			"snapshot_materialization_failed",
			"Scannable path is not a file.",
		);
	}
	await fs.copyFile(sourcePath, destinationPath);
}

async function verifyCopiedEntry(
	targetPath: string,
	entry: DiffManifestEntry,
): Promise<void> {
	if (!entry.contentSha256) return;
	const stat = await fs.lstat(targetPath);
	const content = stat.isSymbolicLink()
		? Buffer.from(await fs.readlink(targetPath), "utf8")
		: await fs.readFile(targetPath);
	const actual = crypto.createHash("sha256").update(content).digest("hex");
	if (actual !== entry.contentSha256) {
		throw new GitDiffResolutionError(
			"target_changed",
			`Changed file mutated while the snapshot was being created: ${entry.path}`,
		);
	}
}

function assertInside(candidate: string, root: string): void {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	if (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative) ||
		relative.includes("\0")
	) {
		throw new GitDiffResolutionError(
			"invalid_diff_path",
			"Snapshot path escaped its root.",
		);
	}
}
