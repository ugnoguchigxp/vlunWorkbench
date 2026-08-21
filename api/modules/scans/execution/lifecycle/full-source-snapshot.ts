import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runGitCommand } from "../diff/git-command";

export type FullSourceSnapshot = {
	rootPath: string;
	projectPath: string;
	sourceRevision: string;
	snapshotDigest: string;
	cleanup: () => Promise<void>;
};

/**
 * Materialize a source-controlled revision in an isolated directory. The
 * scanner receives this tree, never the originating repository or its .git.
 */
export async function materializeFullSourceSnapshot(params: {
	repositoryPath: string;
	sourceRevision: string;
}): Promise<FullSourceSnapshot> {
	if (!/^[a-f0-9]{40,64}$/.test(params.sourceRevision)) {
		throw new Error("source_snapshot_revision_invalid");
	}
	const sourceRoot = await fs.realpath(params.repositoryPath);
	const tempRoot = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "vuln-workbench-source-")),
	);
	const checkoutRoot = path.join(tempRoot, "source");
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) return;
		cleaned = true;
		await fs.rm(tempRoot, { recursive: true, force: true });
	};
	try {
		await runGitCommand({
			cwd: tempRoot,
			args: [
				"clone",
				"--shared",
				"--no-checkout",
				"--",
				sourceRoot,
				checkoutRoot,
			],
			timeoutMs: 120_000,
		});
		await runGitCommand({
			cwd: checkoutRoot,
			args: ["checkout", "--detach", params.sourceRevision],
			timeoutMs: 120_000,
		});
		await fs.rm(path.join(checkoutRoot, ".git"), {
			recursive: true,
			force: true,
		});
		const snapshotDigest = await digestTree(checkoutRoot);
		return {
			rootPath: checkoutRoot,
			projectPath: checkoutRoot,
			sourceRevision: params.sourceRevision,
			snapshotDigest,
			cleanup,
		};
	} catch (error) {
		await cleanup();
		throw error;
	}
}

async function digestTree(root: string): Promise<string> {
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
			} else if (entry.isFile()) {
				hash.update(`f:${relative}\0`);
				hash.update(await fs.readFile(absolute));
			} else if (entry.isSymbolicLink()) {
				hash.update(`l:${relative}\0${await fs.readlink(absolute)}\0`);
			}
		}
	};
	await walk(root);
	return hash.digest("hex");
}
